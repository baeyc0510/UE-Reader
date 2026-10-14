// Retained Codex conversations: one App Server process + thread per chat (sessionKey).
// Thread ids persist in store.data.agentSessions[sessionKey] and resume after restart.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { scopeKey } from '../../source/source.mjs';
import { readAudit, cancelled, REQUEST_TIMEOUT_MS, timeoutMessage } from '../process.mjs';
import { writeSourceManifest, sourceServer, sourceActivity } from '../source-scope.mjs';
import { connectCodex } from './rpc.mjs';
import { sourceServerConfig } from './binary.mjs';

export function createCodexSessions({ store, connect = connectCodex, timeout = REQUEST_TIMEOUT_MS }) {
  const workers = new Map();
  const forget = key => { workers.get(key)?.rpc.close(); workers.delete(key); };
  const close = () => { for (const worker of workers.values()) worker.rpc.close(); workers.clear(); };

  async function run(options) {
    const { sessionKey, sourceRoot, searchScope, indexAccess, directory, prompt, instructions, responseSchema, model, signal, onEvent, onSession, onContext } = options;
    if (signal.aborted) throw cancelled();
    let session = store.data.agentSessions?.[sessionKey];
    if (session && (scopeKey(session.root) !== scopeKey(sourceRoot) || session.provider !== 'codex')) { forget(sessionKey); session = null; }
    if (!session) {
      session = { id: randomUUID(), provider: 'codex', threadId: null, root: sourceRoot, createdAt: new Date().toISOString() };
      await store.update(d => { d.agentSessions ||= {}; d.agentSessions[sessionKey] = session; });
    }
    const sourceNotice = await onSession?.(session);
    const sessionDir = path.join(store.directory, 'agent-sessions', session.id);
    await fs.mkdir(sessionDir, { recursive: true }); await fs.mkdir(directory, { recursive: true });
    // The MCP process re-reads this manifest each call, so every turn audits into its own request folder.
    const manifest = await writeSourceManifest(path.join(sessionDir, 'source-scope.json'), { root: sourceRoot, auditDirectory: directory, searchScope, indexAccess });
    let worker = workers.get(sessionKey);
    if (worker?.rpc.closed) { workers.delete(sessionKey); worker = null; }
    if (!worker) {
      const config = ['web_search="live"', ...(sourceRoot ? sourceServerConfig(sourceServer(manifest), { required: true }) : [])];
      const rpc = await connect({ directory: sessionDir, config });
      try {
        const params = { cwd: sessionDir, model, sandbox: 'read-only', approvalPolicy: 'never', ...(instructions ? { developerInstructions: instructions } : {}) };
        onEvent({ stage: session.threadId ? '이전 Codex 세션 연결 중' : '새 Codex 세션 시작 중' });
        const response = await rpc.request(session.threadId ? 'thread/resume' : 'thread/start', { ...params, ...(session.threadId ? { threadId: session.threadId } : { ephemeral: false }) }, 30000);
        if (!response.thread?.id) throw Error('Codex 세션 ID를 받지 못했습니다.');
        session = { ...session, threadId: response.thread.id };
        await store.update(d => { d.agentSessions[sessionKey] = session; });
        worker = { rpc, threadId: session.threadId, defaultModel: response.model };
        workers.set(sessionKey, worker);
      } catch (error) { rpc.close(); throw Error(`세션 연결 실패: ${error.message} 세션 새로고침으로 새 대화를 시작할 수 있습니다.`); }
    }
    if (signal.aborted) throw cancelled();
    const { rpc, threadId } = worker;
    try {
      return await new Promise((resolve, reject) => {
        let settled = false, turnId = null, finalText = '';
        const messages = new Map();
        const finish = (error, value) => {
          if (settled) return; settled = true; clearTimeout(timer);
          rpc.events.off('notification', notification); rpc.events.off('disconnected', disconnected); signal.removeEventListener('abort', cancel);
          error ? reject(error) : resolve(value);
        };
        const disconnected = error => finish(error);
        // Closing a dedicated worker interrupts only this chat's session. Its disk history is resumable.
        const cancel = () => { finish(cancelled()); forget(sessionKey); };
        const timer = setTimeout(() => { finish(Error(timeoutMessage)); forget(sessionKey); }, timeout);
        const activity = item => {
          const done = ['completed', 'complete', 'failed'].includes(item.status);
          if (item.type === 'mcpToolCall') onEvent(sourceActivity(item.id, item.tool, item.arguments, done ? item.status : 'running'));
          if (item.type === 'webSearch') onEvent({ stage: '웹 자료 확인 중', activity: { id: item.id, type: 'web', tool: 'web_search', detail: item.query || item.action?.query || item.action?.url || '', status: done ? 'complete' : 'running' } });
          if (item.type === 'contextCompaction') onEvent({ stage: '이전 대화 요약 중', activity: { id: item.id, type: 'status', tool: 'compaction', detail: '대화가 길어져 이전 내용을 요약합니다.', status: done ? 'complete' : 'running' } });
        };
        const notification = (method, p) => {
          if (p.threadId !== threadId || (turnId && p.turnId && p.turnId !== turnId)) return;
          if (method === 'turn/started') turnId = p.turn?.id || turnId;
          if (method === 'item/started' || method === 'item/completed') {
            const item = p.item || {}; activity({ ...item, status: method === 'item/completed' ? 'completed' : item.status });
            if (item.type === 'agentMessage') {
              const existing = messages.get(item.id) || { text: '', phase: item.phase };
              const value = { text: item.text || existing.text, phase: item.phase || existing.phase };
              messages.set(item.id, value);
              if (value.phase === 'commentary') onEvent({ activity: { id: item.id, type: 'message', tool: 'commentary', detail: value.text, status: method === 'item/completed' ? 'complete' : 'running' } });
              else if (method === 'item/completed') { finalText = value.text; onEvent({ partial: value.text, stage: '답변 정리 중' }); }
            }
          }
          if (method === 'item/agentMessage/delta') {
            const message = messages.get(p.itemId) || { text: '', phase: null }; message.text += p.delta || ''; messages.set(p.itemId, message);
            if (message.phase === 'commentary') onEvent({ activity: { id: p.itemId, type: 'message', tool: 'commentary', detail: message.text, status: 'running' } });
            else { finalText = message.text; onEvent({ partial: message.text, stage: '답변 작성 중' }); }
          }
          if (method === 'thread/tokenUsage/updated') onEvent({ tokenUsage: p.tokenUsage });
          if (method === 'error') onEvent({ stage: p.willRetry ? '연결 재시도 중' : '응답 오류 확인 중' });
          if (method === 'turn/completed') {
            if (p.turn?.status !== 'completed') return finish(Error(p.turn?.error?.message || 'Codex 응답이 중단되었습니다.'));
            try { finish(null, JSON.parse(finalText)); } catch { finish(Error('Codex 응답 형식을 읽지 못했습니다. 다시 시도하세요.')); }
          }
        };
        rpc.events.on('notification', notification); rpc.events.on('disconnected', disconnected); signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) return cancel();
        onEvent({ stage: '필요한 자료 조사 중' });
        rpc.request('turn/start', { threadId, model: model || worker.defaultModel, input: [{ type: 'text', text: prompt + (sourceNotice ? `\n${sourceNotice}` : '') }], approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' }, outputSchema: responseSchema }, 30000).then(result => { turnId = result.turn?.id || turnId; }).catch(finish);
      });
    } catch (error) { forget(sessionKey); throw error; }
    finally { for (const context of await readAudit(directory)) onContext(context); }
  }
  return { run, forget, close };
}
