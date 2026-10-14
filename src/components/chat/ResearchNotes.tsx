import { Markdown } from '../common/Markdown';
import { basename } from '../../lib/format';
import type { ResearchNotes } from '../../types';

// Findings of the extended-thinking research agent, collapsed under an answer (or a running request).
export function ResearchNotesView({ notes, onNavigate }: { notes?: ResearchNotes | null; onNavigate: (path: string, line?: number) => void }) {
  if (!notes || (!notes.summary && !notes.findings.length)) return null;
  return <details className="research-notes">
    <summary>확장된 사고 · 탐색 에이전트 조사 결과 {notes.findings.length}개</summary>
    {notes.summary && <Markdown text={notes.summary} navigate={onNavigate}/>}
    <ol>{notes.findings.map((f, i) => <li key={i}>
      {f.topic && <strong>{f.topic}</strong>}<Markdown text={f.detail} navigate={onNavigate}/>
      {f.references.map((r, j) => <button key={j} title={r.path} onClick={() => onNavigate(r.path, r.start)}>{basename(r.path)} L{r.start}–{r.end}</button>)}
    </li>)}</ol>
    {!!notes.openQuestions.length && <div className="open-questions"><b>확인하지 못한 점</b><ul>{notes.openQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>}
  </details>;
}
