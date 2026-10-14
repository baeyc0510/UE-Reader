import { useCallback, useEffect, useRef, useState } from 'react';
import { api, json } from '../api/client';
import { defaultSession, type Session } from '../types';

export type SessionUpdate = Partial<Session> | ((s: Session) => Session);

// Per-workspace UI state with a debounced, serialized save. `settle()` flushes before
// switching workspaces or shutting down and reports whether everything was stored.
export function useWorkspaceSession({ ready, workspaceId }: { ready: boolean; workspaceId: string }) {
  const [session, setSession] = useState<Session>(defaultSession);
  const sessionRef = useRef(session); sessionRef.current = session;
  const [saveState, setSaveState] = useState('저장됨');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const pendingSave = useRef<{ workspaceId: string; session: Session } | null>(null);
  const saveChain = useRef(Promise.resolve());
  const update = useCallback((change: SessionUpdate) => setSession(s => typeof change === 'function' ? change(s) : { ...s, ...change }), []);

  const flushSave = useCallback(() => {
    const pending = pendingSave.current; if (!pending) return;
    pendingSave.current = null;
    saveChain.current = saveChain.current.catch(() => {}).then(async () => {
      try { await api(`/workspaces/${pending.workspaceId}/session`, json('PUT', pending.session)); setSaveState('저장됨'); }
      catch { setSaveState('저장 실패'); if (!pendingSave.current) pendingSave.current = pending; }
    });
  }, []);
  const settle = useCallback(async () => { clearTimeout(saveTimer.current); flushSave(); await saveChain.current; return !pendingSave.current; }, [flushSave]);
  const retrySave = () => { if (saveState === '저장 실패') { setSaveState('저장 중'); flushSave(); } };

  useEffect(() => {
    if (!ready || !workspaceId) return;
    setSaveState('저장 중'); pendingSave.current = { workspaceId, session };
    clearTimeout(saveTimer.current); saveTimer.current = setTimeout(flushSave, 450);
    return () => clearTimeout(saveTimer.current);
  }, [session, ready, workspaceId, flushSave]);
  useEffect(() => {
    // pagehide cannot await; keepalive lets the last state reach the server.
    const save = () => { const p = pendingSave.current; if (p) fetch(`/api/workspaces/${p.workspaceId}/session`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p.session), keepalive: true }).catch(() => {}); };
    const visibility = () => { if (document.visibilityState === 'hidden') flushSave(); };
    window.addEventListener('pagehide', save); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', visibility); };
  }, [flushSave]);

  return { session, setSession, sessionRef, update, flushSave, settle, saveState, retrySave };
}
