import { useState, type ReactNode } from 'react';
import { Pencil, Check, X } from 'lucide-react';

export type NoteContentEdit = { part: 'overview' | 'detail' | 'body'; index?: number; text: string; title?: string; expectedText: string; expectedTitle?: string };
export function EditableExplanation({ text, title, label, children, save, onEditing }: {
  text: string; title?: string; label: string; children: ReactNode;
  save: (text: string, title: string | undefined, expectedText: string, expectedTitle: string | undefined) => Promise<void>;
  onEditing: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<{ text: string; title?: string; expectedText: string; expectedTitle?: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  function close() { setDraft(null); setError(''); onEditing(false); }
  async function submit() {
    if (!draft || busy) return;
    setBusy(true); setError('');
    try { await save(draft.text, draft.title, draft.expectedText, draft.expectedTitle); close(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className={`editable-explanation ${draft ? 'editing' : ''}`}>
    {draft ? <div className="explanation-editor" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape' && !busy) { e.preventDefault(); close(); } if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }}>
      {title !== undefined && <label>항목 제목<input aria-label={`${label} 제목 편집`} value={draft.title || ''} maxLength={160} disabled={busy} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>}
      <label>해설 내용<textarea autoFocus aria-label={`${label} 내용 편집`} value={draft.text} maxLength={30000} disabled={busy} onChange={e => setDraft({ ...draft, text: e.target.value })}/></label>
      <small>Markdown 사용 가능 · Ctrl+Enter 저장 · Esc 취소</small>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <div className="explanation-edit-actions"><button disabled={busy} onClick={close}><X size={13}/>취소</button><button disabled={busy || !draft.text.trim()} onClick={submit}><Check size={13}/>{busy ? '저장 중…' : '저장'}</button></div>
    </div> : <>{children}<div className="explanation-edit-actions"><button aria-label={`${label} 편집`} onClick={() => { setDraft({ text, title, expectedText: text, expectedTitle: title }); setError(''); onEditing(true); }}><Pencil size={13}/>편집</button></div></>}
  </div>;
}
