import { memo } from 'react';
import { ArrowUpRight, CircleHelp, FileCode2, History } from 'lucide-react';
import { NoteBody } from './NoteBody';
import { AnalysisDiagrams } from './AnalysisDiagrams';
import type { NoteContentEdit } from './EditableExplanation';
import { basename, date } from '../../lib/format';
import { isDetached } from '../../lib/notes';
import type { Context, Note } from '../../types';

export type NoteCardActions = {
  workspaceId: string; running: boolean; hasSource: boolean; selection: Context | null; contexts: Context[];
  agentLabel: (id?: string) => string; navigate: (path: string, line?: number) => void; preview: (range: Context | null) => void;
  save: (id: string, edit: NoteContentEdit) => Promise<void>; jump: (note: Note) => void; ask: (note: Note) => void;
  showQuestion: (conversationId: string, chatId?: string) => void; rename: (note: Note) => void; regenerate: (note: Note) => void; change: (id: string, body: unknown) => void;
};

// One explanation section: overview, linked details, diagrams, evidence and its versions.
// Memoized: the reader re-renders on every scroll step, so actions must be stable (useEventCallback).
export const NoteCard = memo(function NoteCard({ note: n, index, active, versions, ...p }: { note: Note; index: number; active: boolean; versions: Note[] } & NoteCardActions) {
  const detached = isDetached(n), reattach = p.contexts.find(c => c.path === n.path);
  return <article data-note={n.id} className={`note-card ${active ? 'active' : ''} ${detached ? 'stale' : ''}`}>
    <div className="note-meta"><span className="note-number">{String(index + 1).padStart(2, '0')}</span><button className="line-link" onClick={() => p.jump(n)} disabled={detached}>L{n.start}–{n.end}<ArrowUpRight size={12}/></button><span className="note-origin">{n.origin === 'sample' ? '예제' : p.agentLabel(n.agent)} · v{n.revision}</span></div>
    <h2>{n.title}</h2>
    {detached && <div className="stale-warning">{n.sourceState === 'missing' ? '소스 파일 없음' : '소스 변경 감지'} · 자동 연결 중지<button disabled={!p.hasSource || !reattach} onClick={() => { if (reattach) p.change(n.id, { start: reattach.start, end: reattach.end }); }}>선택 라인에 다시 연결</button></div>}
    {n.sourceState === 'moved' && <small className="moved-label">동일한 코드의 새 위치로 연결했습니다.</small>}
    <div className="note-body"><NoteBody note={n} navigate={p.navigate} preview={p.preview} selection={p.selection} save={p.save}/></div>
    <AnalysisDiagrams diagrams={n.diagrams} workspaceId={p.workspaceId} recordId={n.diagramRecordId || n.generationId || ''} noteId={n.id} navigate={p.navigate}/>
    {!!n.evidence?.length && <div className="evidence"><span>참고 코드</span>{n.evidence.map((e, j) => <button key={j} title={e.path} onClick={() => p.navigate(e.path, e.start)}><FileCode2 size={12}/>{basename(e.path)}<small>L{e.start}–{e.end}</small><ArrowUpRight size={12}/></button>)}</div>}
    <div className="note-reading-actions"><button onClick={() => p.ask(n)}><CircleHelp size={12}/>이 구간 질문</button>{n.sourceConversationId && <button onClick={() => p.showQuestion(n.sourceConversationId!, n.sourceChatId)}><History size={12}/>원래 질문·답변</button>}</div>
    <details className="note-source"><summary>이 구간의 코드 · L{n.start}–{n.end}</summary><pre><code>{n.snapshot}</code></pre></details>
    <footer className="note-footer"><small>{date(n.createdAt)}</small><div>
      <button onClick={() => p.rename(n)}>이름 변경</button>
      <button disabled={p.running || !p.hasSource || detached} onClick={() => p.regenerate(n)}>다시 생성</button>
      {versions.length > 1 && <select aria-label="해설 버전" value={n.id} onChange={e => p.change(e.target.value, { selected: true })}>{versions.map(v => <option key={v.id} value={v.id}>v{v.revision}</option>)}</select>}
    </div></footer>
  </article>;
});
