import { Check, Globe2, Loader2, MessageSquare } from 'lucide-react';
import { Markdown } from '../common/Markdown';
import type { Activity } from '../../types';

const label = (a: Activity) => a.type === 'web' ? '웹 검색' : a.tool === 'read_file' ? '소스 읽기' : a.tool === 'read_document' ? '문서 읽기' : a.tool === 'search_documents' ? '문서 검색' : a.tool === 'find_symbol' ? '심볼 찾기' : a.tool === 'list_folders' ? '폴더 구조' : a.tool === 'phase' ? '단계' : a.type === 'status' ? '세션 정리' : '소스 검색';

const plain = (text: string) => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*#>_]/g, '').replace(/\s+/g, ' ').trim();

// Compact live view for explanation jobs: the last few steps, one line each.
export function RecentActivity({ items, count = 3 }: { items: Activity[]; count?: number }) {
  const recent = items.filter(a => a.detail || a.type !== 'message').slice(-count);
  if (!recent.length) return null;
  return <ul className="recent-activity" aria-label="에이전트 진행 상황">{recent.map((a, i) => <li key={a.id || i} className={a.type} title={a.detail}>
    {a.type === 'message' ? <MessageSquare size={12}/> : a.type === 'web' ? <Globe2 size={12}/> : a.status === 'running' ? <Loader2 size={12} className="spin"/> : <Check size={12}/>}
    {a.type === 'message' ? <span>{plain(a.detail)}</span> : <span><b>{label(a)}</b>{a.detail}</span>}
  </li>)}</ul>;
}

// Agent progress: commentary, source reads/searches and web searches. Collapsed once complete.
export function ActivityFeed({ items, live = false }: { items: Activity[]; live?: boolean }) {
  if (!items.length) return null;
  const content = <div className="activity-list">{items.map((a, i) => <div className={`activity-item ${a.type}`} key={a.id || i}>
    {a.type === 'message' ? <MessageSquare size={13}/> : a.type === 'web' ? <Globe2 size={13}/> : a.status === 'running' && live ? <Loader2 size={13} className="spin"/> : <Check size={13}/>}
    {a.type === 'message' ? <div><Markdown text={a.detail} navigate={() => {}}/></div> : <span><b>{label(a)}</b>{a.detail && <span>{a.detail}</span>}</span>}
  </div>)}</div>;
  return live ? content : <details className="agent-activity"><summary>진행 과정 · {items.length}개 기록</summary>{content}</details>;
}
