// Codex App Server JSON-RPC over stdio. One connection owns one child; never reuse the desktop daemon.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { resolveCodex, disableFlags } from './binary.mjs';

export async function connectCodex({ directory, config = [] } = {}) {
  const args = ['--no-daemon', 'app-server', '--listen', 'stdio://', '-c', 'mcp_servers={}', '-c', 'approval_policy="never"', '-c', 'sandbox_mode="read-only"', '-c', 'project_doc_max_bytes=0', ...disableFlags()];
  for (const value of config) args.push('-c', value);
  const resolved = await resolveCodex();
  const child = spawn(resolved.command, [...resolved.prefix, ...args], { cwd: directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...resolved.env } });
  const events = new EventEmitter(), pending = new Map(), decoder = new StringDecoder('utf8');
  let sequence = 0, buffer = '', closed = false;
  const send = message => { if (closed) throw Error('Codex 연결이 종료되었습니다.'); child.stdin.write(JSON.stringify(message) + '\n'); };
  const fail = error => {
    if (closed) return;
    closed = true;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
    pending.clear(); events.emit('disconnected', error);
  };
  const close = () => { fail(Error('Codex 연결이 종료되었습니다.')); child.stdin.end(); child.kill(); };
  const request = (method, params = {}, timeout = 20000) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Codex 요청 시간이 초과되었습니다 (${method}).`)); }, timeout);
    pending.set(id, { resolve, reject, timer });
    try { send({ id, method, params }); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
  child.on('error', error => fail(error));
  child.on('close', () => fail(Error('Codex 연결이 종료되었습니다. 다음 질문에서 다시 연결합니다.')));
  child.stdin.on('error', error => fail(error));
  child.stderr.on('data', () => {});
  child.stdout.on('data', chunk => {
    buffer += decoder.write(chunk);
    const lines = buffer.split('\n'); buffer = lines.pop() || '';
    for (const line of lines) {
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (message.method && message.id !== undefined) {
        // This app exposes read-only tools. Unexpected requests fail closed.
        try { send({ id: message.id, error: { code: -32601, message: 'UE Reader does not support this request.' } }); } catch {}
      } else if (message.id !== undefined) {
        const p = pending.get(message.id); if (!p) continue;
        pending.delete(message.id); clearTimeout(p.timer);
        if (message.error) p.reject(Error(message.error.message || `Codex ${methodName(message)} 실패`)); else p.resolve(message.result);
      } else if (message.method) events.emit('notification', message.method, message.params || {});
    }
  });
  try {
    await request('initialize', { clientInfo: { name: 'ue_reader', title: 'UE Reader', version: '1.1.0' } });
    send({ method: 'initialized', params: {} });
  } catch (error) { close(); throw error; }
  return { request, events, close, get closed() { return closed; }, pid: child.pid };
}
const methodName = message => message.method || '요청';

export function normalizeRateLimits(result) {
  const byId = result?.rateLimitsByLimitId;
  const buckets = byId && Object.keys(byId).length ? Object.values(byId) : result?.rateLimits ? [result.rateLimits] : [];
  return buckets.map((bucket, i) => ({
    id: bucket.limitId || String(i), name: bucket.limitName || bucket.limitId || 'Codex',
    windows: ['primary', 'secondary'].flatMap(key => {
      const w = bucket[key];
      if (!w || typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent)) return [];
      return [{ key, remainingPercent: Math.max(0, Math.min(100, 100 - w.usedPercent)), windowDurationMins: w.windowDurationMins ?? null, resetsAt: w.resetsAt ?? null }];
    })
  })).filter(b => b.windows.length);
}

export async function readCodexLimits({ directory } = {}) {
  const rpc = await connectCodex({ directory });
  try { return await rpc.request('account/rateLimits/read'); } finally { rpc.close(); }
}

export function createUsageReader({ directory, provider = readCodexLimits, ttl = 60000 }) {
  let cached = null, pending = null;
  return async (force = false) => {
    if (pending) return pending;
    if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < ttl) return cached;
    pending = (async () => {
      try {
        const buckets = normalizeRateLimits(await provider({ directory }));
        cached = { buckets, fetchedAt: new Date().toISOString(), stale: false, warning: buckets.length ? '' : '현재 로그인에서는 남은 사용량을 제공하지 않습니다.' };
        return cached;
      } catch {
        return { buckets: cached?.buckets || [], fetchedAt: cached?.fetchedAt || null, stale: true, warning: '남은 사용량을 조회하지 못했습니다.' };
      }
    })();
    try { return await pending; } finally { pending = null; }
  };
}
