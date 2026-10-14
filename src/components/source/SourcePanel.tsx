import { useMemo, useState, type RefObject } from 'react';
import { ArrowDown, Braces, ChevronsLeftRight, CircleHelp, Code2, Copy, CornerDownRight, FileCode2, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { IconButton } from '../common/IconButton';
import { ContextMenu, type MenuItem } from '../common/ContextMenu';
import { CodePane, type CodeHandle, type CodeTarget } from './CodePane';

export type CodeAction = 'definition' | 'declaration' | 'references' | 'symbols' | 'ask' | 'copy';
import type { Context, Note, Source } from '../../types';

type Props = {
  codeRef: RefObject<CodeHandle>; workspaceId: string; source: Source | null; loading: boolean; fileError: string; fontFamily: string; fontSize: number; wrap: boolean;
  contexts: Context[]; activeNote?: Note; preview: Context | null; visibleLine: number; findOpen: boolean; find: string;
  onFind: (text: string) => void; onFindOpen: (open: boolean) => void; onCounterpart: () => void; onCopy: () => void; onReload: (restore: boolean) => void; onRelocate: () => void;
  onCodeAction: (action: CodeAction, target: CodeTarget) => void; indexReady: boolean;
  onScroll: (line: number, top: number, user: boolean) => void; onSelect: (start: number, end: number, shift: boolean, toggle?: boolean) => void; onPreviewSelection: (range: Context | null, reveal: boolean) => void;
};

// Read-only source view: toolbar, in-file find and go-to-line, virtualized code.
export function SourcePanel(p: Props) {
  const [goto, setGoto] = useState(''), [menu, setMenu] = useState<CodeTarget | null>(null);
  const matches = useMemo(() => p.source && p.find ? p.source.text.split('\n').flatMap((line, i) => line.toLowerCase().includes(p.find.toLowerCase()) ? [i + 1] : []) : [], [p.source, p.find]);
  const next = () => p.codeRef.current?.go(matches.find(n => n > p.visibleLine) || matches[0]);
  const selected = p.source && p.contexts.some(c => c.path === p.source!.path);
  return <section className="source-panel">
    <div className="section-toolbar"><div className="section-label"><Code2 size={15}/><strong>원본 소스</strong><span>C++</span></div><div className="toolbar-actions">
      <IconButton label="헤더·구현 파일 전환" disabled={!p.source} onClick={p.onCounterpart}><ChevronsLeftRight size={15}/></IconButton>
      <IconButton label="파일 내 검색 (Ctrl F)" onClick={() => p.onFindOpen(!p.findOpen)} active={p.findOpen}><Search size={15}/></IconButton>
      <IconButton label="선택한 코드 복사" disabled={!selected} onClick={p.onCopy}><Copy size={15}/></IconButton>
      <IconButton label="소스 다시 읽기" onClick={() => p.onReload(false)}><RefreshCw size={14} className={p.loading ? 'spin' : ''}/></IconButton>
    </div></div>
    {p.findOpen && <div className="find-bar"><input autoFocus aria-label="파일 내 검색" placeholder="파일 내 검색" value={p.find} onChange={e => p.onFind(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && matches.length) next(); }}/><small>{matches.length}개</small>
      <IconButton label="다음 검색 결과" disabled={!matches.length} onClick={next}><ArrowDown size={14}/></IconButton>
      <input className="line-input" aria-label="이동할 라인" placeholder="행" value={goto} onChange={e => setGoto(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && p.source && Number(goto) >= 1 && Number(goto) <= p.source.lines) p.codeRef.current?.go(Number(goto)); }}/>
      <IconButton label="검색 닫기" onClick={() => p.onFindOpen(false)}><X size={14}/></IconButton></div>}
    {p.fileError && <div className="inline-error">{p.fileError}<button onClick={p.onRelocate}>소스 폴더 재지정</button></div>}
    {p.source ? <CodePane fontFamily={p.fontFamily} preview={p.preview} key={`${p.workspaceId}/${p.source.path}`} ref={p.codeRef} source={p.source} fontSize={p.fontSize} wrap={p.wrap} contexts={p.contexts} activeNote={p.activeNote} find={p.find} onScroll={p.onScroll} onSelect={p.onSelect} onPreviewSelection={p.onPreviewSelection} onContextMenu={setMenu}/>
      : <div className="empty-code">{p.loading ? <><Loader2 className="spin"/>소스 불러오는 중</> : <><FileCode2/>소스를 표시할 수 없습니다.<button onClick={() => p.onReload(true)}>다시 시도</button></>}</div>}
    {menu && <ContextMenu x={menu.x} y={menu.y} label="코드 메뉴" onClose={() => setMenu(null)} items={codeMenu(menu, p.indexReady).map(item => ({ ...item, onSelect: () => p.onCodeAction(item.action, menu) }))}/>}
    <div className="source-footer"><span><span className="selection-key"/>줄 번호 클릭·드래그로 질문에 첨부 · 우클릭으로 정의 이동·참조 검색</span><span>{p.source?.lines.toLocaleString() || '—'} lines</span></div>
  </section>;
}

// IDE-style actions for the identifier under the pointer. Navigation needs the code index.
function codeMenu(t: CodeTarget, indexReady: boolean): (Omit<MenuItem, 'onSelect'> & { action: CodeAction })[] {
  const items: (Omit<MenuItem, 'onSelect'> & { action: CodeAction })[] = [];
  const name = t.scope ? `${t.scope}::${t.word}` : t.word, pending = indexReady ? '' : ' (인덱스 준비 중)';
  if (t.word) items.push(
    { action: 'definition', label: `정의로 이동 · ${name}${pending}`, icon: <CornerDownRight size={13}/> },
    { action: 'declaration', label: `선언으로 이동${pending}`, icon: <CornerDownRight size={13}/> },
    { action: 'references', label: `모든 참조 검색 · ${t.word}`, icon: <Search size={13}/> },
    { action: 'symbols', label: '심볼 검색에서 보기', icon: <Braces size={13}/> },
    { action: 'ask', label: `${t.word}에 대해 질문하기`, icon: <CircleHelp size={13}/> });
  if (t.selection) items.push({ action: 'copy', label: '선택한 텍스트 복사', icon: <Copy size={13}/> });
  if (!items.length) items.push({ action: 'symbols', label: '심볼 검색 열기', icon: <Braces size={13}/> });
  return items;
}
