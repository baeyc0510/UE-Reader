import { Markdown } from '../common/Markdown';
import { useState, type ReactNode } from 'react';
import { EditableExplanation, type NoteContentEdit } from './EditableExplanation';
import type { Context, Note } from '../../types';
import { isDetached } from '../../lib/notes';

export function NoteBody({ note, navigate, preview, selection, save }: { note: Note; navigate: (path: string, line?: number) => void; preview: (range: Context | null) => void; selection: Context | null; save: (id: string, edit: NoteContentEdit) => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const connected = !isDetached(note);
  const matches = (start: number, end: number) => connected && selection?.path === note.path && selection.start <= end && selection.end >= start;
  const editor = (part: NoteContentEdit['part'], text: string, label: string, children: ReactNode, index?: number, title?: string) => <EditableExplanation text={text} title={title} label={label}
    onEditing={value => { setEditing(value ? `${part}:${index ?? ''}` : null); if (value) preview(null); }}
    save={(text, title, expectedText, expectedTitle) => save(note.id, { part, index, text, title, expectedText, expectedTitle })}>{children}</EditableExplanation>;
  if (!note.details?.length) return <div className={matches(note.start, note.end) ? 'source-linked-highlight' : ''}>
    {editor('body', note.body, note.title, <Markdown text={note.body} navigate={navigate}/>)}</div>;
  const highlight = (start: number, end: number) => { if (connected && !editing) preview({ path: note.path, start, end }); };
  // The overview covers the whole function, so hovering it highlights the full range.
  const signature = () => highlight(note.start, note.end);
  return <>{note.overview && <section className={`function-overview ${connected ? 'connected' : ''} ${matches(note.start, note.start) ? 'source-linked-highlight' : ''}`} tabIndex={connected ? 0 : undefined}
    title={connected ? `소스 L${note.start}–${note.end} 강조` : '소스가 변경되어 연결을 중지했습니다.'}
    onMouseEnter={signature} onMouseLeave={() => preview(null)} onFocus={e => { if (e.target === e.currentTarget) signature(); }} onBlur={() => preview(null)}><h3>함수 개요</h3>
    {editor('overview', note.overview, `${note.title} 함수 개요`, <Markdown text={note.overview} navigate={navigate}/>)}</section>}
    {note.overview && <h3 className="function-details-heading">주요 동작 분석</h3>}
    {note.details.map((d, i) => <div key={i} className={`note-sentence ${connected ? 'connected' : ''} ${matches(d.start, d.end) ? 'source-linked-highlight' : ''}`} tabIndex={connected ? 0 : undefined}
    data-start={d.start} data-end={d.end} title={connected ? `소스 L${d.start}–${d.end} 강조` : '소스가 변경되어 문장 연결을 중지했습니다.'}
    onMouseEnter={() => highlight(d.start, d.end)} onMouseLeave={() => preview(null)}
    onFocus={e => { if (e.target === e.currentTarget) highlight(d.start, d.end); }} onBlur={() => preview(null)}>
    {editor('detail', d.text, `${note.title} 항목 ${i + 1}`, <>{d.title && <h4>{d.title}</h4>}<Markdown text={d.text} navigate={navigate}/><small>L{d.start}–{d.end}</small></>, i, d.title || '')}
  </div>)}</>;
}
