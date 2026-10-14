// Main-thread handle for per-workspace code index workers (see worker.mjs).
// Saved under <dataDir>/code-index/<workspaceId>; refreshed on open, on request and periodically.
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { sourceScope, scopeKey } from '../source.mjs';

const REFRESH_MS = 10 * 60 * 1000, QUERY_TIMEOUT_MS = 30000;

export function createCodeIndexes({ dataDir, refreshMs = REFRESH_MS }) {
  const services = new Map();
  function start(w) {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { scope: sourceScope(w), dir: path.join(dataDir, 'code-index', w.id) } });
    const pending = new Map();
    let sequence = 0, closed = false, status = { status: 'loading', processed: 0, total: 0, parsed: 0, files: 0, symbols: 0, tokens: 0, builtAt: null, error: '' };
    worker.on('message', message => {
      if (message.type === 'status') status = { ...status, ...message.status };
      if (message.type !== 'reply') return;
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(new Error(message.error)) : request.resolve(message.result);
    });
    const failAll = error => { status = { ...status, status: 'error', error: error.message }; for (const r of pending.values()) { clearTimeout(r.timer); r.reject(error); } pending.clear(); };
    worker.on('error', failAll);
    worker.on('exit', () => { if (!closed) failAll(new Error('코드 인덱스 작업이 중단되었습니다. 다시 빌드하세요.')); });
    worker.unref();
    const timer = setInterval(() => { if (status.status === 'ready') worker.postMessage({ type: 'update' }); }, refreshMs);
    timer.unref();
    const query = (op, args) => new Promise((resolve, reject) => {
      if (closed) return resolve(null);
      const id = ++sequence;
      pending.set(id, { resolve, reject, timer: setTimeout(() => { pending.delete(id); reject(new Error('코드 인덱스 응답 시간이 초과되었습니다.')); }, QUERY_TIMEOUT_MS) });
      worker.postMessage({ type: 'query', id, op, args });
    });
    return {
      key: scopeKey(w),
      status: () => status,
      ready: () => status.files > 0 && !status.error?.startsWith('코드 인덱스 작업이 중단'),
      update: (full = false) => { if (!closed) worker.postMessage({ type: 'update', full }); },
      symbols: args => query('symbols', args),
      candidates: (q, within) => query('candidates', { q, within }),
      // A worker stuck in a file system call must not block shutdown.
      close() { closed = true; clearInterval(timer); failAll(new Error('코드 인덱스를 닫았습니다.')); return Promise.race([worker.terminate(), new Promise(resolve => setTimeout(resolve, 3000).unref())]); },
    };
  }
  /** The index for a workspace with a source root, started on first use. */
  function get(w) {
    if (!w?.root) return null;
    let service = services.get(w.id);
    if (service && service.key !== scopeKey(w)) { void service.close(); service = null; }
    if (!service) { service = start(w); services.set(w.id, service); }
    return service;
  }
  // close() resolves once every worker stopped, so callers can delete or reuse the data folder.
  return { get, peek: id => services.get(id) || null, async close() { const stopping = [...services.values()].map(s => s.close()); services.clear(); await Promise.allSettled(stopping); } };
}
