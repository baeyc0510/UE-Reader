import { useCallback, useEffect, useState } from 'react';
import { api, json } from '../api/client';
import type { CodeIndexStatus } from '../types';

// Code index build status of a source workspace; polls quickly while building.
export function useCodeIndex(workspaceId: string, enabled: boolean) {
  const [status, setStatus] = useState<CodeIndexStatus | null>(null);
  const load = useCallback(() => api<CodeIndexStatus>(`/workspaces/${workspaceId}/code-index`).then(setStatus).catch(() => {}), [workspaceId]);
  useEffect(() => {
    setStatus(null);
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>, stopped = false;
    const tick = async () => { await load(); if (!stopped) timer = setTimeout(tick, document.visibilityState === 'visible' ? 2000 : 15000); };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [enabled, load]);
  const refresh = (full = false) => api<CodeIndexStatus>(`/workspaces/${workspaceId}/code-index`, json('POST', { full })).then(setStatus).catch(() => {});
  return { status, refresh };
}
