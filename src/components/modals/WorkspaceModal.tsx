import { ArrowUpRight, Check, ChevronRight, Code2, Folder, FolderOpen, Loader2, Sparkles } from 'lucide-react';
import { Modal } from '../common/Modal';
import type { Workspace } from '../../types';

type Props = { relocate: boolean; rootInput: string; connecting: boolean; error: string; workspaces: Workspace[]; workspaceId: string;
  onRoot: (value: string) => void; onConnect: (demo?: boolean) => void; onActivate: (w: Workspace) => void; onGeneral: () => void; close: () => void };

export function WorkspaceModal(p: Props) {
  return <Modal title={p.relocate ? '소스 폴더 다시 연결' : '소스 작업공간'} close={p.close}><div className="modal-body">
    <p className="muted">Unreal Engine 또는 분석할 C++ 소스 폴더를 지정하세요.</p>
    <button className="secondary full general-chat-button" onClick={p.onGeneral}><Sparkles size={15}/>일반 질문 열기 · 소스 폴더 없이</button>
    <label className="field-label">소스 폴더 경로<input autoFocus placeholder="D:\UnrealEngine\Engine\Source" value={p.rootInput} onChange={e => p.onRoot(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && p.rootInput.trim()) p.onConnect(); }}/></label>
    <p className="field-help">Windows 탐색기에서 폴더 경로를 복사해 붙여 넣으세요.</p>
    <button className="primary full" disabled={!p.rootInput.trim() || p.connecting} onClick={() => p.onConnect()}>{p.connecting ? <Loader2 className="spin" size={16}/> : <FolderOpen size={16}/>} {p.relocate ? '기존 해설과 다시 연결' : '작업공간 열기'}</button>
    {p.error && <div className="inline-error" role="alert">{p.error}</div>}
    {!!p.workspaces.length && <div className="workspace-list"><h3>최근 작업공간</h3>{p.workspaces.map(w => <button key={w.id} onClick={() => p.onActivate(w)}><Folder size={18}/><span><strong>{w.name}</strong><small>{w.root}{w.folders?.length ? ` + 폴더 ${w.folders.length}개` : ''}</small></span>{w.id === p.workspaceId ? <Check size={15}/> : <ChevronRight size={15}/>}</button>)}</div>}
    <button className="demo-button" disabled={p.connecting} onClick={() => p.onConnect(true)}><Code2 size={16}/><span>예제로 둘러보기<small>직접 작성한 액터 코드와 해설</small></span><ArrowUpRight size={16}/></button>
  </div></Modal>;
}
