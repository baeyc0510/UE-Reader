// Read-only index access for the agent source tools. The tools run in a separate MCP process
// (agents/source-mcp.mjs), so each request grants a token that the process sends to
// POST /api/agent-index (routes/code-index.mjs); the token is revoked when the request ends.
// local(id) is the same access in-process (tests, injected source tools).
import { randomUUID } from 'node:crypto';
import { fail } from './source.mjs';

export const MAX_SYMBOL_RESULTS = 50;
const KINDS = ['definition', 'declaration', 'type'];
export const scopeList = value => (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
  .map(item => String(item).replaceAll('\\', '/').trim().replace(/^\.?\/+|\/+$/g, '')).filter(item => item && item !== '.' && !item.split('/').includes('..')).slice(0, 20);

export function createAgentIndex({ workspace, getIndex, codeIndexes }) {
  const grants = new Map(); // token → workspace id
  // Looked up per call so a folder change during a request never restarts the index with a stale record.
  const local = id => {
    const code = () => { const w = workspace(id); return w.root ? codeIndexes.get(w) : null; };
    return {
      async files() { const index = getIndex(workspace(id)); await index.done; return { files: index.files, documents: index.documents, status: index.status }; },
      async candidates(q, within = []) { const c = code(); return c?.ready() ? c.candidates(q, within).catch(() => null) : null; },
      async symbols(args) { const c = code(); return c?.ready() ? c.symbols(args).catch(() => null) : null; },
    };
  };
  return {
    local,
    grant(id) { const token = randomUUID(); grants.set(token, id); return token; },
    revoke(token) { grants.delete(token); },
    async query(token, op, args = {}) {
      const id = grants.get(token);
      if (!id) throw fail('만료되었거나 허용되지 않은 인덱스 요청입니다.', 403);
      const access = local(id), within = scopeList(args.within);
      if (op === 'files') return access.files();
      if (op === 'candidates') return access.candidates(String(args.q || '').slice(0, 160), within);
      if (op === 'symbols') return access.symbols({ q: String(args.q || '').slice(0, 200), exact: args.exact !== false, kind: KINDS.includes(args.kind) ? args.kind : undefined, scope: String(args.scope || ''), within, limit: Math.min(MAX_SYMBOL_RESULTS, Math.max(1, Number(args.limit) || 20)) });
      throw fail('지원하지 않는 인덱스 요청입니다.');
    },
  };
}
