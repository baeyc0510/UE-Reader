import { useState } from 'react';
import { FolderOpen, FolderPlus, FolderSymlink, Loader2, Trash2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { IconButton } from '../common/IconButton';
import type { Workspace } from '../../types';

type Props = { workspace: Workspace; close: () => void; onRelocate: () => void; onAdd: (path: string, name: string) => Promise<void>; onRemove: (name: string) => Promise<void> };

const folderName = (value: string) => value.trim().replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || '';

// Folders of one workspace: the main folder plus extra folders mounted as `<name>/…` (e.g. a game project next to the engine).
export function FoldersModal({ workspace, close, onRelocate, onAdd, onRemove }: Props) {
  const [path, setPath] = useState(''), [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const add = () => run(async () => { await onAdd(path.trim(), name.trim()); setPath(''); setName(''); });
  return <Modal title="작업공간 폴더" close={close} wide><div className="modal-body folders-modal">
    <p className="field-help">한 작업공간에 여러 소스 폴더를 함께 열 수 있습니다. 예를 들어 엔진 소스에 내 프로젝트 폴더를 추가하면, 프로젝트 코드에 대해 질문하면서 엔진 코드까지 따라가 읽을 수 있습니다. 추가한 폴더는 탐색기에서 <b>이름/</b> 아래에 표시됩니다.</p>
    <ul className="folder-list" aria-label="작업공간 폴더">
      <li><FolderOpen size={17}/><span><strong>기본 폴더</strong><small>{workspace.root}</small></span><button className="text-action" onClick={onRelocate}>다시 연결</button></li>
      {(workspace.folders || []).map(f => <li key={f.name}><FolderSymlink size={17}/><span><strong>{f.name}/</strong><small>{f.path}</small></span>
        <IconButton label={`${f.name} 폴더 제거`} disabled={busy} onClick={() => run(() => onRemove(f.name))}><Trash2 size={14}/></IconButton></li>)}
    </ul>
    <form className="folder-add" onSubmit={e => { e.preventDefault(); if (path.trim() && !busy) void add(); }}>
      <label className="field-label">추가할 폴더 경로<input aria-label="추가할 폴더 경로" placeholder="D:\Projects\MyGame" value={path} onChange={e => setPath(e.target.value)}/></label>
      <label className="field-label">표시 이름<input aria-label="폴더 표시 이름" placeholder={folderName(path) || '폴더 이름'} value={name} maxLength={60} onChange={e => setName(e.target.value)}/></label>
      <button type="submit" className="primary" disabled={!path.trim() || busy}>{busy ? <Loader2 size={15} className="spin"/> : <FolderPlus size={15}/>}폴더 추가</button>
    </form>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <p className="field-help">폴더를 제거해도 그 폴더의 해설은 지워지지 않으며, 같은 이름으로 다시 추가하면 다시 연결됩니다. 폴더를 바꾸면 파일 목록과 코드 인덱스를 새로 만듭니다(추가한 폴더만 분석).</p>
  </div></Modal>;
}
