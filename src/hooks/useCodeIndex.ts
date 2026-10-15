import { useCallback, useEffect, useRef, useState } from 'react';
import { api, json } from '../api/client';
import type { CodeIndexStatus } from '../types';

const BUSY_MS = 2000, READY_MS = 30000, HIDDEN_MS = 30000;

// Code index build status of a source workspace; polls quickly while building, slowly once ready.
// A new status object re-renders the whole reader, so an unchanged response keeps the old one.
export function useCodeIndex(workspaceId: string, enabled: boolean) {
  const [status, setStatus] = useState<CodeIndexStatus | null>(null);
  const last = useRef(''), poke = useRef<() => void>();
  const apply = useCallback((next: CodeIndexStatus) => { const key = JSON.stringify(next); if (key !== last.current) { last.current = key; setStatus(next); } return next; }, []);
  const load = useCallback(() => api<CodeIndexStatus>(`/workspaces/${workspaceId}/code-index`).then(apply).catch(() => null), [workspaceId, apply]);
  useEffect(() => {
    setStatus(null); last.current = '';
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>, stopped = false, loading = false;
    // One timer at a time: a poke during a request is picked up by that request's reschedule.
    const tick = async () => {
      if (loading) return;
      loading = true; const next = await load(); loading = false;
      if (stopped) return;
      const busy = !next || next.status !== 'ready' || !next.files;
      clearTimeout(timer); timer = setTimeout(tick, document.visibilityState !== 'visible' ? HIDDEN_MS : busy ? BUSY_MS : READY_MS);
    };
    // A manual refresh starts a rebuild, so polling switches back to the fast pace right away.
    poke.current = () => { if (stopped) return; clearTimeout(timer); timer = setTimeout(tick, BUSY_MS); };
    void tick();
    return () => { stopped = true; clearTimeout(timer); poke.current = undefined; };
  }, [enabled, load]);
  const refresh = (full = false) => api<CodeIndexStatus>(`/workspaces/${workspaceId}/code-index`, json('POST', { full })).then(next => { apply(next); poke.current?.(); }).catch(() => {});
  return { status, refresh };
}
