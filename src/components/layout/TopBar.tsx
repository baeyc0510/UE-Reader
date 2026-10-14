import { BookOpen, ChevronDown, Code2, FolderOpen, Power, Search, Settings2 } from 'lucide-react';
import { IconButton } from '../common/IconButton';
import type { AgentInfo, AgentStatus, Workspace } from '../../types';

type Props = { workspace?: Workspace; agent: AgentInfo; status: AgentStatus; ready: boolean; onWorkspace: () => void; onSearch: () => void; onSaved: () => void; onSettings: () => void; onExit: () => void };

export function TopBar({ workspace, agent, status, ready, onWorkspace, onSearch, onSaved, onSettings, onExit }: Props) {
  return <header className="topbar">
    <a className="brand" href="#" onClick={e => { e.preventDefault(); onWorkspace(); }}><span className="brand-mark"><Code2 size={23}/></span><span>UE<span className="brand-light"> Reader</span><small>SOURCE EXPLORER</small></span></a>
    <div className="header-divider"/>
    <button className="workspace-button" onClick={onWorkspace}><FolderOpen size={16}/><span>{workspace?.name || '작업공간 열기'}</span><ChevronDown size={13}/>{workspace && <span className="version-badge">{workspace.demo ? 'DEMO' : `UE ${workspace.version}`}</span>}</button>
    <button className="global-search" onClick={onSearch} disabled={!workspace}><Search size={15}/><span>파일 또는 코드 검색</span><kbd>Ctrl P</kbd></button>
    <button className="top-action" disabled={!workspace} onClick={onSaved}><BookOpen size={16}/><span>저장한 해설</span></button>
    <button className={`codex-status ${status.authenticated ? 'online' : ''}`} title={status.message} onClick={onSettings}><span className="status-dot"/>{status.authenticated ? `${agent.label} 연결됨` : `${agent.label} 연결 확인`}</button>
    <IconButton label="설정" onClick={onSettings}><Settings2 size={18}/></IconButton>
    <IconButton label="앱 종료" disabled={!ready} onClick={onExit}><Power size={18}/></IconButton>
  </header>;
}
