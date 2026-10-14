import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Usage } from '../types';

// Remaining account usage of the selected agent, refreshed every minute while visible.
export function useUsage(agentId: string) {
  const [usage, setUsage] = useState<Usage | null>(null), [loading, setLoading] = useState(false);
  const refresh = useCallback(async (force = false) => {
    if (!agentId) return;
    setLoading(true);
    try { setUsage(await api(`/agents/${agentId}/usage${force ? '?refresh=1' : ''}`)); }
    catch { setUsage(old => ({ buckets: old?.buckets || [], fetchedAt: old?.fetchedAt || null, stale: true, warning: '사용량을 조회하지 못했습니다.' })); }
    finally { setLoading(false); }
  }, [agentId]);
  useEffect(() => {
    setUsage(null); void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { usage, loading, refresh };
}
