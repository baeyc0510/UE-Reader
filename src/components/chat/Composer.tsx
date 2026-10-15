import { useEffect, useRef, useState } from 'react';
import { BrainCircuit, ChevronDown, Crosshair, FileCode2, FileText, Loader2, Paperclip, RefreshCw, Search, Send, X } from 'lucide-react';
import { basename, date, duration } from '../../lib/format';
import { useEventCallback } from '../../hooks/useEventCallback';
import { registerPendingEdit } from '../../lib/pending-edits';
import type { AgentInfo, Attachment, Context, ConversationSettings, Usage } from '../../types';

type Props = {
  agent: AgentInfo; model: string | null; settings: ConversationSettings; running: boolean; hasWorkspace: boolean;
  usage: Usage | null; usageLoading: boolean; draft: string; contexts: Context[]; removable: Context[];
  attachments: Attachment[]; attaching: boolean; onAttach: (files: File[]) => void; onRemoveAttachment: (id: string) => void;
  extended: boolean; onExtended: (on: boolean) => void;
  searchScope: string[]; onSearchScope: (paths: string[]) => void;
  onModelSettings: () => void; onResetSession: () => Promise<void>; onRefreshUsage: () => void;
  onDraft: (text: string) => void; onSend: (text: string) => void; onCancel: () => void; onRemove: (path: string) => void;
};

// Typing stays inside the composer: the reader (and every chat item) re-renders only when typing
// pauses, the box loses focus or the question is sent. Outside changes to the draft are adopted.
const DRAFT_DELAY_MS = 200;
function useLocalDraft(draft: string, onDraft: (text: string) => void) {
  const [text, setText] = useState(draft);
  const sent = useRef(draft), timer = useRef<ReturnType<typeof setTimeout>>();
  const flush = useEventCallback(() => { clearTimeout(timer.current); if (text !== sent.current) { sent.current = text; onDraft(text); } });
  const change = (value: string) => { setText(value); clearTimeout(timer.current); timer.current = setTimeout(flush, DRAFT_DELAY_MS); };
  useEffect(() => { if (draft !== sent.current) { sent.current = draft; clearTimeout(timer.current); setText(draft); } }, [draft]);
  useEffect(() => { const unregister = registerPendingEdit(flush); return () => { unregister(); flush(); }; }, [flush]);
  return { text, change, flush };
}

const attachmentSize = (a: Attachment) => a.pages ? `${a.pages}쪽` : `${Math.max(1, Math.round(a.chars / 1000))}k자`;

// Question input fixed under both right-hand tabs: agent/model, session state, usage, attached code and files.
export function Composer(p: Props) {
  const [resetting, setResetting] = useState(false), [resetError, setResetError] = useState(''), [dropping, setDropping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const usage = p.usage, empty = !p.contexts.length && !p.attachments.length;
  const draft = useLocalDraft(p.draft, p.onDraft);
  const send = () => { draft.flush(); p.onSend(draft.text); };
  const attach = (files: FileList | null) => { if (files?.length) p.onAttach([...files]); };
  return <div className="composer">
    <div className="composer-top"><div className="composer-mode"><button className="composer-model" onClick={p.onModelSettings} aria-label="응답 모델 설정" title="응답 에이전트와 모델 설정">{p.agent.label} · {p.model || '기본 모델'}<ChevronDown size={11}/></button>
      <button className={`thinking-toggle${p.extended ? ' on' : ''}`} aria-pressed={p.extended} aria-label="확장된 사고" onClick={() => p.onExtended(!p.extended)}
        title={p.extended ? '확장된 사고 켜짐: 탐색 에이전트가 먼저 코드를 넓게 조사하고, 해설은 검토 단계에서 보충·다듬습니다. 시간과 사용량이 더 듭니다.' : '확장된 사고: 별도 탐색 에이전트로 더 넓고 깊게 분석하고, 해설은 검토 단계에서 보충·다듬습니다.'}><BrainCircuit size={12}/>확장된 사고</button></div>
      {p.settings.retainSession ? <button className="session-reset" disabled={p.running || resetting} onClick={async () => { setResetting(true); setResetError(''); try { await p.onResetSession(); } catch (e) { setResetError((e as Error).message); } finally { setResetting(false); } }} title="저장된 답변은 보존하고 이 채팅의 다음 질문부터 새 세션을 시작합니다."><RefreshCw size={12} className={resetting ? 'spin' : ''}/>세션 새로고침</button> : <span className="history-count">이전 대화 {p.settings.historyCount}개</span>}
    </div>
    <div className="usage-bar" aria-label={`${p.agent.label} 남은 사용량`} title={usage?.fetchedAt ? `계정 전체 사용량 · 조회 ${date(usage.fetchedAt)}` : '계정 전체 사용량'}>
      <span>남은 사용량</span>{usage?.buckets.flatMap(b => b.windows.map(w => <span className="usage-window" key={`${b.id}-${w.key}`} title={`${b.name} · ${w.resetsAt ? new Date(w.resetsAt * 1000).toLocaleString('ko-KR') + ' 초기화' : '초기화 시간 미제공'}`}>{usage.buckets.length > 1 ? `${b.name} · ` : ''}{duration(w.windowDurationMins)} <b>{Math.round(w.remainingPercent)}%</b></span>))}
      {!usage?.buckets.length && <span>{p.usageLoading ? '조회 중…' : usage?.warning || '조회 대기'}</span>}{usage?.stale && !!usage.buckets.length && <span title={usage.warning}>이전 조회값</span>}
      {!usage?.unsupported && <button aria-label="사용량 새로고침" disabled={p.usageLoading} onClick={p.onRefreshUsage}><RefreshCw size={11} className={p.usageLoading ? 'spin' : ''}/></button>}
    </div>
    {resetError && <p className="model-warning" role="alert">{resetError}</p>}
    {p.hasWorkspace && <div className="search-scope" aria-label="에이전트 검색 범위" title="에이전트의 파일·코드 검색이 기본으로 살펴볼 범위입니다. 탐색기에서 폴더나 파일을 우클릭해 지정합니다. 범위 밖 정의는 필요할 때만 전체에서 찾습니다.">
      <Crosshair size={11}/><span>검색 범위</span>
      {p.searchScope.length ? <>{p.searchScope.map(path => <span key={path} className="scope-chip" title={path}>{basename(path)}<button aria-label={`${basename(path)} 검색 범위 제거`} onClick={() => p.onSearchScope(p.searchScope.filter(x => x !== path))}><X size={10}/></button></span>)}
        <button className="scope-clear" onClick={() => p.onSearchScope([])}>전체로</button></> : <b>작업공간 전체</b>}
    </div>}
    <div className="context-chips">{p.contexts.map((c, i) => <span key={`${c.path}-${i}`} title={c.path}><FileCode2 size={11}/>{basename(c.path)}<b>L{c.start}–{c.end}</b>{p.removable.some(s => s.path === c.path) && <button aria-label={`${basename(c.path)} 컨텍스트 제거`} onClick={() => p.onRemove(c.path)}><X size={11}/></button>}</span>)}
      {p.attachments.map(a => <span key={a.id} className="attachment-chip" title={`${a.name} · ${a.chars.toLocaleString('ko-KR')}자`}><FileText size={11}/>{a.name}<b>{attachmentSize(a)}</b><button aria-label={`${a.name} 첨부 제거`} onClick={() => p.onRemoveAttachment(a.id)}><X size={11}/></button></span>)}
      {p.attaching && <span><Loader2 size={11} className="spin"/>파일 읽는 중…</span>}
      {empty && !p.attaching && <span><Search size={11}/>첨부한 코드 없음 · {p.hasWorkspace ? '질문에 따라 소스 탐색' : '일반 질문'}</span>}</div>
    <div className={`input-box${dropping ? ' drop-target' : ''}`} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }} onDragLeave={() => setDropping(false)} onDrop={e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDropping(false); attach(e.dataTransfer.files); }}>
      <textarea aria-label="코드 질문" placeholder={!empty ? '첨부한 코드와 파일을 참고해 질문합니다. 필요한 관련 구현도 탐색합니다.' : '엔진에 대해 자유롭게 질문하세요. 화면 코드는 자동 첨부하지 않습니다.'} value={draft.text} onChange={e => draft.change(e.target.value)} onBlur={draft.flush} onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter' && !e.nativeEvent.isComposing && draft.text.trim() && !p.running && !p.attaching) { e.preventDefault(); send(); } }}/>
      <div><span>{p.settings.retainSession ? '세션 유지 ON' : '세션 유지 OFF'} · Ctrl Enter</span>
        <div className="composer-actions">
          <input ref={fileRef} type="file" multiple hidden aria-hidden="true" tabIndex={-1} onChange={e => { attach(e.target.files); e.target.value = ''; }}/>
          <button className="attach-button" aria-label="파일 첨부" title="PDF·텍스트 파일을 질문에 첨부합니다. 작업공간 밖의 파일도 됩니다. (끌어다 놓기 가능)" disabled={p.attaching} onClick={() => fileRef.current?.click()}><Paperclip size={14}/></button>
          {p.running ? <button className="cancel-request" onClick={p.onCancel}>중지</button> : <button className="send-button" aria-label="질문 보내기" title="질문 보내기 (Ctrl Enter)" disabled={!draft.text.trim() || p.attaching} onClick={send}><Send size={15}/></button>}
        </div></div></div>
  </div>;
}
