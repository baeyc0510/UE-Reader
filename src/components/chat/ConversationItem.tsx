import { ArrowUpRight, FileCode2, Globe2, Loader2 } from 'lucide-react';
import { Markdown } from '../common/Markdown';
import { AnalysisDiagrams } from '../explanation/AnalysisDiagrams';
import { ActivityFeed } from './ActivityFeed';
import { AnswerActions } from './AnswerActions';
import { readable } from './readable';
import { ResearchNotesView } from './ResearchNotes';
import { basename, date } from '../../lib/format';
import type { Conversation } from '../../types';

export type ConversationActions = {
  workspaceId: string; hasWorkspace: boolean; hasFile: boolean; running: boolean; retryable: boolean; explainingThis: boolean;
  agentLabel: (id?: string) => string; onNavigate: (path: string, line?: number) => void; onVisualize: () => void; onExplain: (path: string) => void;
  onShowExplanation: (path: string, start: number, id?: string) => void; onRetry: () => void; onShowNotes: () => void;
};

// One stored question and its answer, sources and follow-up actions.
export function ConversationItem({ c, newSession, ...p }: { c: Conversation; newSession: boolean } & ConversationActions) {
  const attached = c.attachedContexts ? c.attachedContexts.length ? `선택 코드 ${c.attachedContexts.length}개 첨부` : '코드 첨부 없이 질문' : c.path ? basename(c.path) : '파일 지정 없이 질문';
  return <article className="conversation" data-conversation={c.id}>
    {newSession && <div className="session-divider">새 {p.agentLabel(c.agent)} 세션</div>}
    <div className="question"><span>Q</span><strong>{c.question || '코드 분석'}</strong></div>
    <small>{attached}{!!c.attachedFiles?.length && <span className="attached-files" title={c.attachedFiles.map(f => `${f.name}${f.truncated ? ' (앞부분만 전달)' : ''}`).join('\n')}> · 파일 {c.attachedFiles.length}개 첨부({c.attachedFiles.map(f => f.name).join(', ')})</span>} · {date(c.createdAt)} · {p.agentLabel(c.agent)} · {c.model || '기본 모델'}{c.extended && ' · 확장된 사고'}</small>
    {c.modelNotice && <p className="model-warning">{c.modelNotice}</p>}
    <ActivityFeed items={c.activity || []}/>
    <ResearchNotesView notes={c.research} onNavigate={p.onNavigate}/>
    <div className="answer"><Markdown text={readable(c.answer) || c.error || '응답 없음'} navigate={p.onNavigate}/></div>
    <AnalysisDiagrams diagrams={c.diagrams} workspaceId={p.workspaceId} recordId={c.id} navigate={p.onNavigate}/>
    {!c.kind && !!c.sections?.length && <details className="legacy-answer"><summary>이 답변의 기존 상세 해설 · {c.sections.length}개</summary>{c.sections.map(s => <section key={s.id}><h4>{s.title}</h4><Markdown text={s.body} navigate={p.onNavigate}/></section>)}</details>}
    {c.status === 'complete' && <button className="visualize-answer" disabled={p.running} onClick={p.onVisualize}>흐름 시각화 · 호출 관계 / 라이프사이클</button>}
    {!!c.suggestedFiles?.length && <div className="suggested-files"><h3>에이전트가 선택한 파일</h3>{c.suggestedFiles.map((f, i) => <button key={`${f.path}-${i}`} onClick={() => p.onNavigate(f.path, f.start)} title={f.path}><FileCode2 size={15}/><span><strong>{basename(f.path)} <small>L{f.start}–{f.end}</small></strong><em>{f.reason}</em><small className="suggested-path">{f.path}</small></span><ArrowUpRight size={14}/></button>)}</div>}
    {!!c.webSources?.length && <div className="web-sources"><h3><Globe2 size={12}/>웹 출처</h3>{c.webSources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noopener noreferrer">{s.title}<ArrowUpRight size={11}/></a>)}</div>}
    {!!c.context.length && <details className="sent-context"><summary>확인한 코드 {c.context.length}개 구간</summary>{c.context.map((ctx, i) => <div key={i}><button onClick={() => p.onNavigate(ctx.path, ctx.start)}>{ctx.path} L{ctx.start}–{ctx.end}{ctx.automatic ? ' · 에이전트 선택' : ' · 질문 컨텍스트'}</button><pre>{ctx.text}</pre></div>)}</details>}
    {c.status === 'complete' ? <AnswerActions conversation={c} hasWorkspace={p.hasWorkspace} disabled={p.running} explain={p.onExplain} show={p.onShowExplanation}/>
      : <div className="request-error" role="status">{c.status === 'cancelled' ? '요청이 취소되었습니다.' : c.error || '요청을 완료하지 못했습니다.'}{p.retryable && <button onClick={p.onRetry}>다시 시도</button>}</div>}
    {p.explainingThis && <div className="live-status"><Loader2 size={13} className="spin"/><span>이 답변의 코드 해설을 작성하고 있습니다.</span>{p.hasFile && <button onClick={p.onShowNotes}>진행 보기</button>}</div>}
  </article>;
}
