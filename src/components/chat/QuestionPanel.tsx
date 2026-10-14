import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUpRight, BookOpen, Check, CircleHelp, Loader2, MessageSquare, Search, X } from 'lucide-react';
import { Markdown } from '../common/Markdown';
import { ActivityFeed, RecentActivity } from './ActivityFeed';
import { ChatBar } from './ChatBar';
import { Composer } from './Composer';
import { ConversationItem } from './ConversationItem';
import { readable } from './readable';
import { ResearchNotesView } from './ResearchNotes';
import type { AgentInfo, Attachment, Chat, Context, Conversation, ConversationSettings, Job, Usage } from '../../types';

export type QuestionPanelProps = {
  workspaceId: string; agent: AgentInfo; agentLabel: (id?: string) => string; model: string | null; onModelSettings: () => void;
  settings: ConversationSettings; onResetSession: () => Promise<void>;
  usage: Usage | null; usageLoading: boolean; onRefreshUsage: () => void;
  tab: 'notes' | 'questions'; onTab: (tab: 'notes' | 'questions') => void; explanation: ReactNode;
  height: number; onHeight: (height: number) => void;
  hasFile: boolean; hasWorkspace: boolean; draft: string; contexts: Context[]; selected: Context[];
  attachments: Attachment[]; attaching: boolean; onAttach: (files: File[]) => void; onRemoveAttachment: (id: string) => void;
  extended: boolean; onExtended: (on: boolean) => void;
  searchScope: string[]; onSearchScope: (paths: string[]) => void;
  chats: Chat[]; activeChatId: string; onSelectChat: (id: string) => void; onNewChat: () => void; onRenameChat: (id: string, title: string) => Promise<void>; onDeleteChat: (chat: Chat) => void;
  conversations: Conversation[]; job: Job | null;
  focusConversation: { id: string; serial: number }; onShowQuestion: (conversationId: string, chatId?: string) => void;
  onShowExplanation: (path: string, start: number, id?: string) => void;
  onExplainAnswer: (conversation: Conversation, path: string) => void; onVisualizeAnswer: (conversation: Conversation) => void;
  onDraft: (text: string) => void; onSend: () => void; onRemove: (path: string) => void;
  onNavigate: (path: string, line?: number) => void;
  onCancel: () => void; onDismiss: () => void; onRetry: () => void; onRetrySave: () => void; onRestoreNotes: (ids: string[]) => void;
};

function explanationStatus(job: Job, running: boolean) {
  const r = job.refine;
  if (running) return `${job.kind === 'refine' ? '해설 다듬기' : '코드 해설 생성'} · ${job.stage}`;
  if (job.status !== 'complete') return job.error || (job.kind === 'refine' ? '해설 다듬기를 취소했습니다.' : '해설 생성을 취소했습니다.');
  if (r) return r.updated + r.added + r.removed ? `해설을 다듬었습니다 · 수정 ${r.updated} · 추가 ${r.added} · 삭제 ${r.removed}` : '바꿀 부분이 없어 해설을 그대로 두었습니다.';
  const v = job.review;
  return `${job.generatedNotes?.length || 0}개 구간의 해설을 저장했습니다.${v ? ` · 확장된 사고 검토: 수정 ${v.updated} · 추가 ${v.added} · 삭제 ${v.removed}` : ''}`;
}

// Right-hand reading area: explanation tab, chat tab and the fixed, resizable composer.
export function QuestionPanel(p: QuestionPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null), panelRef = useRef<HTMLDivElement>(null), composerRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true), [away, setAway] = useState(false);
  const running = p.job?.status === 'running', shown = p.tab === 'questions';
  const questionJob = p.job?.kind === 'question' ? p.job : null;
  const activeJob = questionJob && (questionJob.chatId || '') === p.activeChatId && !p.conversations.some(c => c.id === questionJob.id) ? questionJob : null;
  const explanationJob = p.job && p.job.kind !== 'question' ? p.job : null;
  const maxHeight = () => Math.max(150, (panelRef.current?.clientHeight || 800) * .65);
  const resize = (height: number) => p.onHeight(Math.round(Math.max(150, Math.min(maxHeight(), height))));
  const bottom = () => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; follow.current = true; setAway(false); };
  useEffect(() => { follow.current = true; setAway(false); }, [p.job?.id, p.activeChatId]);
  useEffect(() => { if (shown && follow.current) bottom(); }, [shown, p.job?.partial, p.job?.activity, p.conversations.length, activeJob?.status]);
  useEffect(() => {
    if (!shown || !p.focusConversation.id) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-conversation="${CSS.escape(p.focusConversation.id)}"]`), container = scrollRef.current;
    if (el && container) { follow.current = false; container.scrollTop += el.getBoundingClientRect().top - container.getBoundingClientRect().top - 12; }
  }, [shown, p.focusConversation.serial, p.conversations.length]);
  return <div className="reader-right" ref={panelRef}>
    <div className="right-tabs" role="tablist" aria-label="해설과 질문 전환">
      <button id="notes-tab" role="tab" aria-controls="notes-panel" aria-selected={!shown} disabled={!p.hasFile} onClick={() => p.onTab('notes')}><BookOpen size={15}/>코드 해설{running && explanationJob && <Loader2 size={12} className="spin"/>}</button>
      <button id="questions-tab" role="tab" aria-controls="questions-panel" aria-selected={shown} onClick={() => p.onTab('questions')}><MessageSquare size={15}/>질문과 답변<span>{p.conversations.length}</span>{running && questionJob && <Loader2 size={12} className="spin"/>}</button>
    </div>
    <div id="notes-panel" className="right-tab-content explanation-content" role="tabpanel" aria-labelledby="notes-tab" hidden={shown}>
      {explanationJob && <div className="explanation-progress" aria-live="polite"><div className="live-status">{running ? <Loader2 size={14} className="spin"/> : explanationJob.status === 'complete' ? <Check size={14}/> : <CircleHelp size={14}/>}<span>{explanationStatus(explanationJob, running)}</span>{running ? <button onClick={p.onCancel}>취소</button> : <button aria-label="해설 생성 상태 닫기" onClick={p.onDismiss}><X size={13}/></button>}</div>
        {running && <RecentActivity items={explanationJob.activity || []}/>}
        {explanationJob.sourceConversationId && <button className="return-answer" onClick={() => p.onShowQuestion(explanationJob.sourceConversationId!)}><MessageSquare size={12}/>원래 답변으로</button>}
        {explanationJob.status === 'complete' && explanationJob.refine && <div className="refine-summary"><Markdown text={explanationJob.refine.summary} navigate={p.onNavigate}/></div>}
        {explanationJob.status === 'complete' && explanationJob.review?.summary && <div className="refine-summary" aria-label="확장된 사고 검토 요약"><Markdown text={explanationJob.review.summary} navigate={p.onNavigate}/></div>}
        {explanationJob.status === 'complete' && explanationJob.generatedNotes?.[0] && <button className="return-answer" onClick={() => { const n = explanationJob.generatedNotes![0]; p.onShowExplanation(n.path, n.start, n.id); }}>{explanationJob.refine ? '다듬은 해설로 이동' : '생성한 해설로 이동'}<ArrowUpRight size={12}/></button>}
        {explanationJob.status === 'complete' && !!explanationJob.refine?.removedIds.length && <button className="return-answer" onClick={() => p.onRestoreNotes(explanationJob.refine!.removedIds)}>삭제한 해설 {explanationJob.refine.removedIds.length}개 되돌리기</button>}
        {!!explanationJob.warnings?.length && <ul className="generation-warnings" role="status">{explanationJob.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
        {explanationJob.status === 'failed' && <button onClick={p.onRetry}>다시 시도</button>}{explanationJob.status === 'save_failed' && <button onClick={p.onRetrySave}>다시 저장</button>}
      </div>}{p.explanation}
    </div>
    <div id="questions-panel" className="right-tab-content conversation-panel" role="tabpanel" aria-labelledby="questions-tab" hidden={!shown}>
      <ChatBar chats={p.chats} activeId={p.activeChatId} disabled={running} onSelect={p.onSelectChat} onNew={p.onNewChat} onRename={p.onRenameChat} onDelete={p.onDeleteChat}/>
      <div className="conversation-scroll" ref={scrollRef} onScroll={() => { const el = scrollRef.current!; const near = el.scrollHeight - el.scrollTop - el.clientHeight < 70; follow.current = near; setAway(!near); }}>
        {p.conversations.map((c, index) => <ConversationItem key={c.id} c={c} newSession={!!c.sessionId && c.sessionId !== p.conversations[index - 1]?.sessionId}
          workspaceId={p.workspaceId} hasWorkspace={p.hasWorkspace} hasFile={p.hasFile} running={running} retryable={p.job?.id === c.id} explainingThis={running && explanationJob?.sourceConversationId === c.id}
          agentLabel={p.agentLabel} onNavigate={p.onNavigate} onVisualize={() => p.onVisualizeAnswer(c)} onExplain={file => p.onExplainAnswer(c, file)} onShowExplanation={p.onShowExplanation}
          onRetry={p.onRetry} onShowNotes={() => p.onTab('notes')}/>)}
        {activeJob && <article className={`conversation live-conversation ${activeJob.status}`} aria-label="현재 요청">
          <div className="question"><span>Q</span><strong>{activeJob.question || '코드 해설 요청'}</strong></div>
          <div className="live-status" role="status">{running ? <Loader2 size={15} className="spin"/> : activeJob.status === 'complete' ? <Check size={15}/> : <CircleHelp size={15}/>}<span>{running ? activeJob.stage : activeJob.status === 'complete' ? '답변 완료 · 저장됨' : activeJob.error || '요청 취소'}</span>{running ? <button onClick={p.onCancel}>취소</button> : <button aria-label="요청 상태 닫기" onClick={p.onDismiss}><X size={14}/></button>}</div>
          {activeJob.modelNotice && <p className="model-warning">{activeJob.modelNotice}</p>}
          <ActivityFeed items={activeJob.activity || []} live={!!running}/>
          <ResearchNotesView notes={activeJob.research} onNavigate={p.onNavigate}/>
          {readable(activeJob.partial) && <div className="answer streamed-answer"><Markdown text={readable(activeJob.partial)} navigate={p.onNavigate}/></div>}
          {activeJob.status === 'save_failed' && <button onClick={p.onRetrySave}>다시 저장</button>}{activeJob.status === 'failed' && <button onClick={p.onRetry}>다시 시도</button>}
        </article>}
        {!p.conversations.length && !activeJob && <div className="question-intro"><Search size={24}/><h2>궁금한 것부터 물어보세요.</h2><p>파일을 미리 고르지 않아도 됩니다.<br/>{p.hasWorkspace ? '에이전트가 필요한 소스와 웹 자료를 찾아 분석합니다.' : '지식과 웹 자료로 답하고, 소스 폴더를 연결하면 구현도 찾습니다.'}<br/>질문마다 채팅이 저장되며, 첫 질문으로 제목을 정합니다.{p.hasWorkspace && <><br/>“인벤토리 시스템 코드 해설 만들어 줘”처럼 요청하면 관련 파일을 골라 코드 해설도 생성합니다.</>}</p></div>}
      </div>
      {away && <button className="latest-answer" onClick={bottom}><ArrowDown size={13}/>최근 답변으로</button>}
    </div>
    <div className="fixed-composer" ref={composerRef} style={{ height: p.height }}>
      <div className="composer-resizer" role="separator" aria-label="질문 영역 높이 조절" aria-orientation="horizontal" aria-valuemin={150} aria-valuemax={Math.round(maxHeight())} aria-valuenow={p.height} tabIndex={0}
        onKeyDown={e => { if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) { e.preventDefault(); resize(e.key === 'Home' ? 150 : e.key === 'End' ? maxHeight() : p.height + (e.key === 'ArrowUp' ? 20 : -20)); } }}
        onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) resize(composerRef.current!.getBoundingClientRect().bottom - e.clientY); }}
        onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}><span/></div>
      <Composer agent={p.agent} model={p.model} settings={p.settings} running={running} hasWorkspace={p.hasWorkspace} usage={p.usage} usageLoading={p.usageLoading}
        draft={p.draft} contexts={p.contexts} removable={p.selected} attachments={p.attachments} attaching={p.attaching} onAttach={p.onAttach} onRemoveAttachment={p.onRemoveAttachment} extended={p.extended} onExtended={p.onExtended} searchScope={p.searchScope} onSearchScope={p.onSearchScope} onModelSettings={p.onModelSettings} onResetSession={p.onResetSession} onRefreshUsage={p.onRefreshUsage}
        onDraft={p.onDraft} onSend={p.onSend} onCancel={p.onCancel} onRemove={p.onRemove}/>
    </div>
  </div>;
}
