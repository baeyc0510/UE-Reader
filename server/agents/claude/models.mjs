// Claude Code model discovery through the stream-json control protocol: an `initialize`
// control request returns the account's selectable models (the list behind the Agent SDK's
// supportedModels()). No user message is sent, so no tokens are used.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { killTree } from '../process.mjs';
import { resolveClaude } from './binary.mjs';

// `default` is the CLI's own choice; the app offers it as "기본값" and marks the matching entry instead.
export function normalizeClaudeModels(models) {
  if (!Array.isArray(models)) throw new Error('Claude Code 모델 목록의 형식을 읽을 수 없습니다.');
  const fallback = models.find(m => m?.value === 'default')?.resolvedModel;
  return models.filter(m => m && typeof m.value === 'string' && m.value !== 'default').map(m => ({
    id: m.value,
    displayName: m.displayName || m.value,
    description: [m.description, m.resolvedModel && m.resolvedModel !== m.value ? m.resolvedModel : ''].filter(Boolean).join(' · '),
    isDefault: !!fallback && m.resolvedModel === fallback && m.value !== fallback,
  }));
}

export async function listClaudeModels({ directory } = {}) {
  const resolved = await resolveClaude();
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence'];
  return new Promise((resolve, reject) => {
    const child = spawn(resolved.command, [...resolved.prefix, ...args], { cwd: directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...resolved.env } });
    const decoder = new StringDecoder('utf8');
    let buffer = '', settled = false;
    const finish = (error, models) => {
      if (settled) return; settled = true; clearTimeout(timer);
      child.stdin.end(); killTree(child);
      error ? reject(error) : resolve(models);
    };
    const timer = setTimeout(() => finish(new Error('Claude Code 모델 목록 조회 시간이 초과되었습니다.')), 30000);
    child.on('error', error => finish(new Error(`Claude Code 모델 목록을 조회할 수 없습니다: ${error.message}`)));
    child.on('close', () => finish(new Error('Claude Code가 모델 목록 응답 전에 종료되었습니다. 로그인 상태를 확인하세요.')));
    child.stdin.on('error', () => {});
    child.stderr.on('data', () => {}); // Do not expose local config or authentication diagnostics.
    child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) {
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.type !== 'control_response' || message.response?.request_id !== 'models') continue;
        if (message.response.subtype === 'error') return finish(new Error(`Claude Code 모델 목록 조회 실패: ${message.response.error || '지원되지 않는 인터페이스'}`));
        try { finish(null, normalizeClaudeModels(message.response.response?.models)); } catch (error) { finish(error); }
      }
    });
    child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } }) + '\n');
  });
}
