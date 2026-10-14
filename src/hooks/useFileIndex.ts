import { useEffect, useState } from 'react';
import { api, json } from '../api/client';

// Polls the workspace file index while it is being built. Unchanged revisions skip the file list.
export function useFileIndex(workspaceId: string, report: (e: unknown) => void) {
  const [files, setFiles] = useState<string[]>([]);
  const [info, setInfo] = useState({ count: 0, total: 0, status: 'ready', skipped: 0 });
  const [serial, setSerial] = useState(0);
  useEffect(() => {
    setFiles([]); setInfo({ count: 0, total: 0, status: 'indexing', skipped: 0 });
    if (!workspaceId || workspaceId === 'general') return;
    let stopped = false, revision = '', timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const load = async () => {
      try {
        const data = await api(`/workspaces/${workspaceId}/files?all=1&revision=${encodeURIComponent(revision)}`, { signal: controller.signal });
        if (stopped) return;
        revision = data.revision;
        if (data.files) setFiles(data.files);
        setInfo({ count: data.count, total: data.total, status: data.status, skipped: data.skipped });
        if (data.status === 'indexing') timer = setTimeout(load, 1500);
      } catch (e) { if (!stopped) report(e); }
    };
    void load();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [workspaceId, serial]);
  const rebuild = () => api(`/workspaces/${workspaceId}/index`, json('POST', {})).then(() => setSerial(n => n + 1)).catch(report);
  const cancel = () => api(`/workspaces/${workspaceId}/index`, json('POST', { cancel: true })).catch(report);
  const reload = () => setSerial(n => n + 1);
  return { files, info, rebuild, cancel, reload };
}
