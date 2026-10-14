// Client of the agent index bridge (source/agent-index.mjs), used inside the MCP process.
// Every failure returns null so the source tools fall back to walking and scanning the folders.
const TIMEOUT_MS = 60000;

export function remoteIndex(access) {
  if (!access?.url || !access?.token) return null;
  const post = async (op, args = {}) => {
    const response = await fetch(access.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UE-Reader-Agent-Token': access.token }, body: JSON.stringify({ op, args }), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '인덱스 요청 실패');
    return data.result;
  };
  return {
    // makeIndex-like file list from the app (no folder walk in this process).
    async index() { try { const r = await post('files'); return r ? { ...r, done: Promise.resolve() } : null; } catch { return null; } },
    candidates: (q, within) => post('candidates', { q, within }).catch(() => null),
    symbols: args => post('symbols', args).catch(() => null),
  };
}
