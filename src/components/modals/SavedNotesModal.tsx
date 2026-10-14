import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, FileCode2, Search, Trash2, Wand2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { IconButton } from '../common/IconButton';
import { api } from '../../api/client';
import { basename, date } from '../../lib/format';
import { isDetached, teachingOrder } from '../../lib/notes';
import type { Note, NoteFile } from '../../types';

const stateLabel = { same: '소스 일치', moved: '위치 이동', changed: '소스 변경', missing: '파일 없음' };

type Props = { workspaceId: string; activePath: string; refresh: number; report: (e: unknown) => void; close: () => void; onOpen: (note: Note) => void; onRename: (note: Note) => void; onDelete: (note: Note) => void; onRefine: (paths: string[]) => void };

// Saved explanations, two levels: files with explanations → that file's explanations.
export function SavedNotesModal({ workspaceId, activePath, refresh, report, close, onOpen, onRename, onDelete, onRefine }: Props) {
  const [query, setQuery] = useState(''), [file, setFile] = useState<string | null>(null);
  const [files, setFiles] = useState<NoteFile[]>([]), [notes, setNotes] = useState<Note[]>([]);
  const q = encodeURIComponent(query);
  const load = useCallback(async () => {
    if (file === null) setFiles(await api(`/workspaces/${workspaceId}/notes/files?q=${q}`));
    else setNotes(await api(`/workspaces/${workspaceId}/notes?path=${encodeURIComponent(file)}&q=${q}`));
  }, [workspaceId, file, q]);
  useEffect(() => { const timer = setTimeout(() => load().catch(report), 150); return () => clearTimeout(timer); }, [load, refresh]);
  const sortedFiles = [...files].sort((a, b) => Number(b.path === activePath) - Number(a.path === activePath));
  // Current revisions in reading order first; older revisions after them.
  const sortedNotes = [...teachingOrder(notes.filter(n => n.selected)), ...notes.filter(n => !n.selected)];
  return <Modal title={file ? `저장한 해설 · ${basename(file)}` : '저장한 해설'} close={close} wide>
    <div className="search-controls">
      {file !== null && <IconButton label="파일 목록으로" onClick={() => { setFile(null); setNotes([]); }}><ArrowLeft size={16}/></IconButton>}
      <label><Search size={17}/><input autoFocus placeholder="제목, 파일 경로, 해설 내용으로 검색" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <button className="text-action" disabled={!files.length && !notes.length} onClick={() => onRefine(file !== null ? [file] : files.some(f => f.path === activePath) ? [activePath] : [])}><Wand2 size={13}/>해설 다듬기</button>
    </div>
    {file === null ? <>
      <div className="search-meta">{files.length}개 파일 · 파일을 선택하면 해설 목록을 엽니다 · 현재 파일 우선</div>
      <div className="saved-files">{sortedFiles.map(f => <button key={f.path} title={f.path} onClick={() => setFile(f.path)}>
        <FileCode2 size={18}/><div><strong>{basename(f.path)}{f.path === activePath && <small>현재 파일</small>}</strong><span>{f.path}</span><em>{f.titles.join(' · ')}</em></div>
        <span className="saved-file-meta"><b>{f.count}개 해설</b><small>{f.updatedAt && date(f.updatedAt)}</small></span><ChevronRight size={15}/>
      </button>)}{!files.length && <p className="small-empty">{query ? '검색과 일치하는 해설이 없습니다.' : '저장한 해설이 없습니다.'}</p>}</div>
    </> : <>
      <div className="search-meta">{notes.length}개 해설 · 해설 순서</div>
      <div className="saved-list">{sortedNotes.map(n => <article key={n.id} className={n.selected ? '' : 'older-revision'}>
        <button className="saved-open" onClick={() => onOpen(n)}><div><span className="saved-icon"><BookOpen size={17}/></span><strong>{n.title}</strong><small>v{n.revision}{n.selected ? '' : ' · 이전 버전'}</small></div><p>{n.body.replace(/[#`*]/g, '').slice(0, 110)}</p>
          <footer><span>L{n.start}–{n.end}</span><span>{date(n.createdAt)}</span><span className={isDetached(n) ? 'warning-text' : ''}>{stateLabel[n.sourceState]}</span></footer></button>
        <div className="saved-actions"><button onClick={() => onRename(n)}>이름 변경</button><IconButton label={`${n.title} 삭제`} onClick={() => onDelete(n)}><Trash2 size={14}/></IconButton></div>
      </article>)}{!notes.length && <p className="small-empty">이 파일에 남은 해설이 없습니다.</p>}</div>
    </>}
  </Modal>;
}
