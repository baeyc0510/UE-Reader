import type { RefObject } from 'react';
import { BookOpen, Check, ChevronDown, FileCode2, List, Sparkles, Wand2 } from 'lucide-react';
import { IconButton } from '../common/IconButton';
import { Markdown } from '../common/Markdown';
import { NoteCard, type NoteCardActions } from './NoteCard';
import { stem } from '../../lib/format';
import { latestSummary } from '../../lib/notes';
import type { Note } from '../../types';

type Props = NoteCardActions & {
  file: string; notes: Note[]; allNotes: Note[]; activeNote?: Note; linked: boolean; outlineOpen: boolean; demo: boolean;
  notesRef: RefObject<HTMLDivElement>; onToggleOutline: () => void; onGenerate: (kind: 'overview' | 'explain') => void; onRefine: () => void;
  onScroll: () => void; onUserScroll: () => void;
};

// File explanation in teaching order (notes arrive sorted by lib/notes teachingOrder).
export function ExplanationPanel({ file, notes, allNotes, activeNote, linked, outlineOpen, demo, notesRef, onToggleOutline, onGenerate, onRefine, onScroll, onUserScroll, ...card }: Props) {
  const disabled = !card.hasSource || card.running;
  return <>
    <div className="section-toolbar"><div className="section-label"><Sparkles size={15}/><strong>코드 해설</strong><span>{notes.length}</span></div><div className="toolbar-actions"><IconButton label="해설 목차" onClick={onToggleOutline} active={outlineOpen}><List size={16}/></IconButton><button className="text-action" disabled={card.running || !notes.length} title="에이전트가 저장한 해설을 요청에 맞게 다시 다듬습니다" onClick={onRefine}><Wand2 size={13}/>해설 다듬기</button><button className="text-action" disabled={disabled} onClick={() => onGenerate('overview')}><Sparkles size={13}/>파일 개요 생성</button></div></div>
    <div className={`sync-status ${activeNote ? 'mapped' : ''}`}><span className="status-dot"/>{linked ? activeNote ? `연결됨 · L${activeNote.start}–${activeNote.end}` : '현재 위치에 연결된 해설이 없습니다' : '연결 OFF · 각 영역을 독립적으로 읽습니다'}{!activeNote && card.hasSource && <button disabled={card.running} onClick={() => onGenerate('explain')}>구간 해설 +</button>}</div>
    {outlineOpen && notes.length > 0 && <details className="outline"><summary><List size={13}/>해설 목차 <span>{notes.length}개 구간 · 해설 순서</span><ChevronDown size={13}/></summary><div>{notes.map((n, i) => <button key={n.id} onClick={() => card.jump(n)}><small>{String(i + 1).padStart(2, '0')}</small><span>{n.title}</span><em>L{n.start}</em></button>)}</div></details>}
    <div className="notes-scroll" ref={notesRef} onWheel={onUserScroll} onPointerDown={onUserScroll} onScroll={onScroll}>
      {notes.length ? <>
        <div className="file-overview"><span className="eyebrow">FILE OVERVIEW</span><h1>{stem(file)}<span className="dot">.</span></h1><Markdown text={latestSummary(notes) || '코드 구간에 연결된 해설입니다.'} navigate={card.navigate}/><div className="overview-meta"><span><FileCode2 size={12}/>{notes.length}개 코드 구간</span><span>{demo && allNotes.some(n => n.origin === 'sample') ? '예제 해설 포함' : '이해하기 좋은 순서로 정렬'}</span></div></div>
        {notes.map((n, i) => <NoteCard key={n.id} note={n} index={i} active={activeNote?.id === n.id} versions={allNotes.filter(v => v.groupId === n.groupId)} {...card}/>)}
        <div className="notes-end"><Check size={13}/>해설이 로컬에 저장되어 있습니다.</div>
      </> : <div className="analysis-empty"><div className="empty-icon"><BookOpen size={27}/></div><span className="eyebrow">START EXPLORING</span><h2>첫 해설을 만들어 보세요.</h2><p>파일의 역할부터 살펴보거나,<br/>궁금한 코드 구간을 선택해 설명을 요청하세요.</p><button className="primary" disabled={disabled} onClick={() => onGenerate('overview')}><Sparkles size={15}/>파일 개요 생성</button><button className="subtle" disabled={disabled} onClick={() => onGenerate('explain')}>현재 코드 해설</button><small>생성은 버튼을 누를 때만 시작됩니다.</small></div>}
    </div>
  </>;
}
