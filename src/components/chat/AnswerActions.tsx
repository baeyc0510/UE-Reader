import { useState } from 'react';
import { ArrowUpRight, BookOpen } from 'lucide-react';
import { basename } from '../../lib/format';
import type { Conversation } from '../../types';

// Under a completed answer: links to explanations generated from it, and a request for a new one.
export function AnswerActions({ conversation, hasWorkspace, disabled, explain, show }: { conversation: Conversation; hasWorkspace: boolean; disabled: boolean; explain: (path: string) => void; show: (path: string, start: number, id?: string) => void }) {
  const files = [...new Set([...(conversation.suggestedFiles || []).map(f => f.path), ...conversation.context.map(c => c.path)])];
  const [selected, setSelected] = useState(files[0] || '');
  return <div className="answer-actions">
    {!!conversation.explanations?.length && <div className="answer-explanations"><span>생성한 코드 해설</span>{conversation.explanations.map(n => <button key={n.path} onClick={() => show(n.path, n.start, n.id)}><BookOpen size={13}/>{basename(n.path)}<ArrowUpRight size={12}/></button>)}</div>}
    {hasWorkspace ? <div className="explain-answer-request"><select aria-label="해설 대상 파일" value={selected} onChange={e => setSelected(e.target.value)} disabled={disabled}><option value="">관련 코드 자동 찾기</option>{files.map(file => <option key={file} value={file}>{file}</option>)}</select><button disabled={disabled} onClick={() => explain(selected)}><BookOpen size={13}/>코드 해설 생성</button></div> : <small>소스 작업공간을 연결하면 답변과 관련된 코드 해설을 요청할 수 있습니다.</small>}
    {hasWorkspace && <small>현재 소스를 읽고 구간별 해설을 별도로 작성합니다.</small>}
  </div>;
}
