import { useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronsLeftRight, Crosshair, FileCode2, FolderOpen, FolderPlus, History, Loader2, PanelLeftClose, RefreshCw, Search, ShieldCheck, Star, X } from 'lucide-react';
import { IconButton } from '../common/IconButton';
import { FileTree } from './FileTree';
import { SidebarResize } from './SidebarResize';
import { ContextMenu } from '../common/ContextMenu';
import { addToScope, coveredBy, removeFromScope } from '../../lib/search-scope';
import { basename } from '../../lib/format';
import type { Session, Workspace } from '../../types';

type Props = {
  workspace: Workspace; session: Session; files: string[]; fileInfo: { total: number; status: string; skipped: number }; hasFiles: boolean;
  filter: string; uiSize: number; reveal: number;
  onFilter: (value: string) => void; onWidth: (width: number) => void; onCollapse: () => void; onOpen: (file: string) => void;
  onToggleFolder: (folder: string, expanded: boolean) => void; onCollapseAll: () => void; onRevealCurrent: () => void; onRebuild: () => void; onCancelIndex: () => void; onToggleFavorite: (file: string) => void; onFolders: () => void;
  onSearchScope: (paths: string[]) => void;
};

export function ExplorerSidebar(p: Props) {
  const { session } = p, scope = session.searchScope || [];
  const [menu, setMenu] = useState<{ path: string; folder: boolean; x: number; y: number } | null>(null);
  const parent = menu && coveredBy(scope, menu.path);
  return <aside className="sidebar" style={{ '--sidebar-width': `${Math.max(180, Math.min(600, Number(session.sidebarWidth) || 244))}px` } as CSSProperties}>
    <SidebarResize width={session.sidebarWidth} onChange={p.onWidth}/>
    <div className="panel-heading"><span>탐색기</span><IconButton label="탐색기 접기" onClick={p.onCollapse}><PanelLeftClose size={16}/></IconButton></div>
    <div className="explorer-project"><span className="project-icon"><FolderOpen size={19}/></span><div><strong>{p.workspace.name}</strong><small>{p.workspace.demo ? '직접 작성한 샘플 소스' : `Unreal Engine · ${p.workspace.version}`}</small>{!!p.workspace.folders?.length && <div className="explorer-folders" title="추가한 폴더">{p.workspace.folders.map(f => <span key={f.name} title={f.path}>+ {f.name}</span>)}</div>}</div><IconButton label="작업공간 폴더 관리" onClick={p.onFolders}><FolderPlus size={15}/></IconButton></div>
    <label className="file-filter"><Search size={14}/><input placeholder="파일 이름으로 필터" value={p.filter} onChange={e => p.onFilter(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') p.onFilter(''); }}/>{p.filter && <button onClick={() => p.onFilter('')} aria-label="필터 지우기"><X size={12}/></button>}</label>
    <div className="explorer-scroll">
      {!!session.favorites.length && <details className="side-section" open><summary><ChevronDown size={12}/>즐겨찾기 <span>{session.favorites.length}</span></summary>{session.favorites.map(f => <button key={f} className="recent-file" onClick={() => p.onOpen(f)} title={f}><Star size={13}/>{basename(f)}</button>)}</details>}
      <div className="tree-heading"><span>소스 파일</span><span>{p.fileInfo.total.toLocaleString()}</span>
        <IconButton label="현재 파일 위치 표시" disabled={!session.active} onClick={p.onRevealCurrent}><FileCode2 size={12}/></IconButton>
        <IconButton label="모든 폴더 접기" onClick={p.onCollapseAll}><ChevronsLeftRight size={12}/></IconButton>
        <IconButton label="파일 목록 새로고침" onClick={p.onRebuild}><RefreshCw size={12}/></IconButton></div>
      <FileTree key={p.workspace.id} mounts={p.workspace.folders?.map(f => f.name) || []} files={p.files} filter={p.filter} uiSize={p.uiSize} expanded={session.expandedFolders} reveal={p.reveal} onToggle={p.onToggleFolder} active={session.active} open={p.onOpen} favorites={session.favorites} toggleFavorite={p.onToggleFavorite}
        searchScope={scope} onMenu={(path, folder, x, y) => setMenu({ path, folder, x, y })}/>
      {!p.hasFiles && <p className="small-empty">{p.fileInfo.status === 'indexing' ? '파일 목록을 만드는 중입니다…' : '표시할 소스 파일이 없습니다.'}</p>}
      {p.fileInfo.status === 'indexing' && <div className="index-progress"><Loader2 size={12} className="spin"/>파일 검색 중<button onClick={p.onCancelIndex}>중지</button></div>}
      {p.fileInfo.status === 'cancelled' && <p className="small-empty">목록 생성이 중지되었습니다. 새로고침으로 다시 시작할 수 있습니다.</p>}
      {p.fileInfo.skipped > 0 && <p className="small-empty">{p.fileInfo.skipped}개 폴더에 접근하지 못했습니다.</p>}
      {!!session.tabs.length && <details className="side-section recent" open><summary><ChevronDown size={12}/>열어 본 파일</summary>{session.tabs.slice(-6).reverse().map(f => <button className="recent-file" key={f} title={f} onClick={() => p.onOpen(f)}><History size={13}/>{basename(f)}</button>)}</details>}
    </div>
    {menu && <ContextMenu x={menu.x} y={menu.y} label={`${basename(menu.path)} 메뉴`} onClose={() => setMenu(null)} items={[
      scope.includes(menu.path)
        ? { label: '검색 범위에서 제거', icon: <X size={13}/>, onSelect: () => p.onSearchScope(removeFromScope(scope, menu.path)) }
        : { label: '에이전트 검색 범위에 추가', icon: <Crosshair size={13}/>, disabled: !!parent, hint: parent ? `${basename(parent)} 포함` : undefined, onSelect: () => p.onSearchScope(addToScope(scope, menu.path)) },
      { label: `이 ${menu.folder ? '폴더' : '파일'}만 검색 범위로 지정`, icon: <Crosshair size={13}/>, disabled: scope.length === 1 && scope[0] === menu.path, onSelect: () => p.onSearchScope([menu.path]) },
      { label: '검색 범위 지우기 (작업공간 전체)', icon: <X size={13}/>, divider: true, disabled: !scope.length, onSelect: () => p.onSearchScope([]) },
      ...(menu.folder ? [] : [{ label: session.favorites.includes(menu.path) ? '즐겨찾기 해제' : '즐겨찾기', icon: <Star size={13}/>, divider: true, onSelect: () => p.onToggleFavorite(menu.path) }]),
    ]}/>}
    <div className="sidebar-bottom"><ShieldCheck size={15}/><div>읽기 전용 작업공간<small>소스 파일을 수정하지 않습니다.</small></div></div>
  </aside>;
}
