// Codex model discovery through a short-lived app-server: initialize + model/list only, never a conversation.
import { spawn } from 'node:child_process';
import { exec } from '../process.mjs';
import { normalizeModels } from '../model-catalog.mjs';
import { resolveCodex } from './binary.mjs';

export async function codexVersion() {
  const resolved = await resolveCodex();
  const { stdout } = await exec(resolved.command, [...resolved.prefix, '--version'], { windowsHide: true, timeout: 10000, env: { ...process.env, ...resolved.env } });
  return stdout.trim();
}

export async function listCodexModels({ directory } = {}) {
  const resolved = await resolveCodex();
  return new Promise((resolve, reject) => {
    const child = spawn(resolved.command, [...resolved.prefix, '--no-daemon', 'app-server', '--listen', 'stdio://', '--disable', 'apps', '--disable', 'plugins', '--disable', 'hooks'], { cwd: directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...resolved.env } });
    let buffer = '', settled = false, sequence = 1, pages = 0;
    const entries = [], cursors = new Set();
    const finish = (error, models) => {
      if (settled) return; settled = true; clearTimeout(timer);
      child.stdin.end(); child.kill();
      error ? reject(error) : resolve(models);
    };
    const timer = setTimeout(() => finish(new Error('Codex 모델 목록 조회 시간이 초과되었습니다.')), 20000);
    const send = message => { if (!settled && child.stdin.writable) child.stdin.write(JSON.stringify(message) + '\n'); };
    const nextPage = cursor => send({ id: ++sequence, method: 'model/list', params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) } });
    child.on('error', error => finish(new Error(`Codex 모델 목록을 조회할 수 없습니다: ${error.message}`)));
    child.stdin.on('error', () => {});
    child.stderr.on('data', () => {}); // Do not expose local config or authentication diagnostics.
    child.on('close', () => { if (!settled) finish(new Error('Codex가 모델 목록 응답 전에 종료되었습니다.')); });
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) {
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.id !== sequence) continue;
        if (message.error) return finish(new Error(`Codex 모델 목록 조회 실패: ${message.error.message || '지원되지 않는 인터페이스'}`));
        if (message.id === 1) { send({ method: 'initialized', params: {} }); nextPage(); continue; }
        try {
          entries.push(...normalizeModels(message.result?.data ?? message.result?.models));
          const cursor = message.result?.nextCursor;
          if (cursor) {
            if (cursors.has(cursor) || ++pages > 30) throw new Error('Codex 모델 목록 페이지를 완료하지 못했습니다.');
            cursors.add(cursor); nextPage(cursor);
          } else {
            const models = normalizeModels(entries);
            if (!models.length) throw new Error('Codex가 표시할 모델을 반환하지 않았습니다.');
            finish(null, models);
          }
        } catch (error) { finish(error); }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'ue_reader', title: 'UE Reader', version: '1.0.0' } } });
  });
}
