import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, Crosshair, FileCode2, Folder, FolderSymlink, Star } from 'lucide-react';

import type { TreeRow } from './file-tree.worker';
type Props = { mounts?: string[]; files: string[]; filter: string; uiSize: number; active: string; expanded: string[]; reveal: number; onToggle: (path: string, expanded: boolean) => void; open: (path: string) => void; favorites: string[]; toggleFavorite: (path: string) => void;
  searchScope?: string[]; onMenu?: (path: string, folder: boolean, x: number, y: number) => void };
export function FileTree(p: Props) {
  const ref = useRef<HTMLDivElement>(null), worker = useRef<Worker>(), serial = useRef(0), sentFiles = useRef<string[]>();
  const [rows, setRows] = useState<TreeRow[]>([]), [busy, setBusy] = useState(true), [error, setError] = useState(false);
  const [viewport, setViewport] = useState({ top: 0, height: 500 });
  const [filterClosed, setFilterClosed] = useState<{ query: string; paths: string[] }>({ query: '', paths: [] });
  const revealed = useRef(''), previousRows = useRef<TreeRow[]>([]), previousFilter = useRef(p.filter);
  const followActive = useRef(true);
  const rowHeight = Math.max(32, Math.ceil(p.uiSize * 2.5));
  useEffect(() => {
    const w = new Worker(new URL('./file-tree.worker.ts', import.meta.url), { type: 'module' }); worker.current = w;
    w.onmessage = e => { if (e.data.serial === serial.current) { setRows(e.data.rows); setBusy(false); } };
    w.onerror = () => { setError(true); setBusy(false); };
    return () => { w.terminate(); sentFiles.current = undefined; };
  }, []);
  useEffect(() => {
    const next = ++serial.current; setBusy(true);
    const timer = setTimeout(() => {
      worker.current?.postMessage({ serial: next, ...(sentFiles.current !== p.files ? { files: p.files } : {}), expanded: p.expanded, filter: p.filter, filterClosed: filterClosed.query === p.filter ? filterClosed.paths : [] });
      sentFiles.current = p.files;
    }, p.filter ? 100 : 0);
    return () => clearTimeout(timer);
  }, [p.files, p.expanded, p.filter, filterClosed]);
  useLayoutEffect(() => {
    const el = ref.current!;
    const resize = new ResizeObserver(() => setViewport({ top: el.scrollTop, height: el.clientHeight }));
    resize.observe(el); return () => resize.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = ref.current; if (!el || busy) return;
    const key = `${p.active}:${p.reveal}`;
    const index = rows.findIndex(row => row.path === p.active);
    if (index >= 0 && (revealed.current !== key || (followActive.current && previousRows.current !== rows && !p.filter))) {
      el.scrollTop = Math.max(0, index * rowHeight - el.clientHeight * .35);
      revealed.current = key;
      followActive.current = true;
    } else if (previousFilter.current !== p.filter) el.scrollTop = 0;
    else if (previousRows.current !== rows) {
      // Keep the visible row stable as background indexing adds files.
      const before = previousRows.current[Math.floor(el.scrollTop / rowHeight)];
      const next = before ? rows.findIndex(row => row.path === before.path) : -1;
      if (next >= 0) el.scrollTop = next * rowHeight + el.scrollTop % rowHeight;
    }
    previousRows.current = rows; previousFilter.current = p.filter;
    setViewport({ top: el.scrollTop, height: el.clientHeight });
  }, [rows, busy, p.active, p.reveal, p.filter, rowHeight]);
  const first = Math.max(0, Math.floor(viewport.top / rowHeight) - 6);
  const last = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / rowHeight) + 6);
  function toggle(row: TreeRow) {
    if (p.filter) setFilterClosed(old => {
      const paths = old.query === p.filter ? old.paths : [];
      return { query: p.filter, paths: row.open ? [...paths, row.path] : paths.filter(path => path !== row.path) };
    });
    p.onToggle(row.path, !row.open);
  }
  // Right-click (or Shift+F10 / context-menu key) opens the row menu, e.g. the agent search scope.
  const menuProps = (path: string, folder: boolean) => p.onMenu ? {
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); p.onMenu!(path, folder, e.clientX, e.clientY); },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); p.onMenu!(path, folder, r.left + 24, r.bottom); } },
  } : {};
  const scoped = (path: string) => !!p.searchScope?.includes(path);
  return <div className="tree-viewport" ref={ref} tabIndex={0} aria-label="소스 파일 목록" aria-busy={busy} onKeyDown={() => { followActive.current = false; }} onWheel={() => { followActive.current = false; }} onPointerDown={() => { followActive.current = false; }} onScroll={e => setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
    {error ? <p className="small-empty">파일 목록을 표시하지 못했습니다. 앱을 다시 열어 주세요.</p> : <div className="virtual-tree" data-row-count={rows.length} style={{ height: rows.length * rowHeight }}>
      {rows.slice(first, last).map((row, i) => {
        const style = { top: (first + i) * rowHeight, height: rowHeight, paddingLeft: 12 + row.depth * 13 };
        return row.folder ? <details className={`tree-folder virtual-tree-row ${p.mounts?.includes(row.path) ? 'mounted' : ''} ${scoped(row.path) ? 'in-search-scope' : ''}`} data-folder={row.path} key={row.path} open={row.open} style={{ top: style.top, height: rowHeight }}>
          <summary style={{ paddingLeft: style.paddingLeft, height: rowHeight }} title={scoped(row.path) ? `${row.path} · 에이전트 검색 범위` : row.path} onClick={e => { e.preventDefault(); toggle(row); }} {...menuProps(row.path, true)}><ChevronRight size={12}/>{p.mounts?.includes(row.path) ? <FolderSymlink size={14}/> : <Folder size={14}/>}<span>{row.name}</span>{scoped(row.path) && <Crosshair size={12} className="scope-mark" aria-label="검색 범위"/>}</summary>
        </details> : <div className={`tree-file virtual-tree-row ${p.active === row.path ? 'active' : ''} ${scoped(row.path) ? 'in-search-scope' : ''}`} key={row.path} style={style}>
          <button aria-current={p.active === row.path ? 'page' : undefined} onClick={() => p.open(row.path)} title={scoped(row.path) ? `${row.path} · 에이전트 검색 범위` : row.path} {...menuProps(row.path, false)}><FileCode2 size={15}/><span>{row.name}</span>{scoped(row.path) && <Crosshair size={12} className="scope-mark" aria-label="검색 범위"/>}<small>{row.name.split('.').pop()?.toUpperCase()}</small></button>
          <button className={`favorite ${p.favorites.includes(row.path) ? 'starred' : ''}`} title="즐겨찾기 전환" onClick={() => p.toggleFavorite(row.path)}><Star size={12}/></button>
        </div>;
      })}
    </div>}
    {!busy && !rows.length && !!p.filter && <p className="small-empty">일치하는 파일이 없습니다.</p>}
  </div>;
}
