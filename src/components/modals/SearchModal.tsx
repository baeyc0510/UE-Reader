import { useEffect, useState } from 'react';
import { ArrowUpRight, Braces, FileCode2, Loader2, Search } from 'lucide-react';
import { Modal } from '../common/Modal';
import { api } from '../../api/client';
import { basename } from '../../lib/format';
import type { SymbolHit, SymbolQuery } from '../../types';

export type SearchMode = 'files' | 'code' | 'symbols';
type Result = { path: string; line?: number; text?: string; symbol?: SymbolHit };
const kindLabel: Record<string, string> = { class: '클래스', struct: '구조체', union: '공용체', enum: '열거형', function: '함수 정의', declaration: '선언', macro: '매크로', alias: '타입 별칭', delegate: '델리게이트', variable: '변수', enumerator: '열거자' };
const filterLabel = { definition: '정의', declaration: '선언', type: '타입' };

// Ctrl+P files, code text (index-accelerated) and Ctrl+T symbols (types, functions, macros).
export function SearchModal({ workspaceId, hasWorkspace, initial, near, report, close, onOpen }: { workspaceId: string; hasWorkspace: boolean; initial: SymbolQuery & { mode?: SearchMode }; near: string; report: (e: unknown) => void; close: () => void; onOpen: (path: string, line?: number) => void }) {
  const [term, setTerm] = useState(initial.term), [mode, setMode] = useState<SearchMode>(initial.mode || 'files');
  // A symbol lookup from the code context menu keeps its filter until the text is edited.
  const [lookup, setLookup] = useState(initial.mode === 'symbols' && (initial.exact || initial.kind || initial.scope) ? initial : null);
  const [results, setResults] = useState<Result[]>([]), [status, setStatus] = useState(''), [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true); setStatus('');
      try {
        if (mode === 'files') { const r = await api(`/workspaces/${workspaceId}/files?q=${encodeURIComponent(term)}`, { signal: controller.signal }); setResults(r.files.map((path: string) => ({ path }))); setStatus(`${r.count.toLocaleString()}개 파일${r.count > 300 ? ' · 처음 300개 표시' : ''}`); }
        else if (mode === 'code') {
          const r = await api(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(term)}`, { signal: controller.signal }); setResults(r.results);
          setStatus(term.length < 2 ? '두 글자 이상 입력하세요.' : `${r.results.length}개 결과 · ${r.indexed ? `코드 인덱스로 ${r.candidates.toLocaleString()}개 후보 파일 확인` : `${r.scanned.toLocaleString()} / ${r.total.toLocaleString()}개 파일 검색`}${r.complete ? '' : ' · 일부 범위 검색'}${r.skipped ? ` · ${r.skipped}개 읽기 실패` : ''}`);
        } else {
          const params = new URLSearchParams({ q: term, near, ...(lookup?.exact ? { exact: '1' } : {}), ...(lookup?.kind ? { kind: lookup.kind } : {}), ...(lookup?.scope ? { scope: lookup.scope } : {}) });
          const r = await api(`/workspaces/${workspaceId}/symbols?${params}`, { signal: controller.signal });
          setResults(r.results.map((symbol: SymbolHit) => ({ path: symbol.path, line: symbol.line, text: symbol.preview, symbol })));
          setStatus(!r.ready ? '코드 인덱스를 만드는 중입니다. 잠시 후 다시 검색하세요.' : !term.trim() ? '타입, 함수, 변수, 매크로 이름을 입력하세요.' : `${r.results.length}개 심볼${r.fallback ? ' · 정의가 없어 선언을 표시' : ''}`);
        }
      } catch (e) { if (!controller.signal.aborted) report(e); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [workspaceId, term, mode, lookup]);
  return <Modal title="빠른 검색" close={close} wide>
    <div className="search-controls"><label><Search size={18}/><input autoFocus placeholder={mode === 'symbols' ? '타입, 함수, 변수, 매크로 이름' : '파일 이름, 경로 또는 코드 문자열'} value={term} onChange={e => { setTerm(e.target.value); setLookup(null); }}/>{searching && <Loader2 size={16} className="spin"/>}</label>
      <div className="segmented"><button className={mode === 'files' ? 'active' : ''} onClick={() => setMode('files')}>파일</button><button className={mode === 'symbols' ? 'active' : ''} onClick={() => setMode('symbols')}>심볼</button><button className={mode === 'code' ? 'active' : ''} onClick={() => setMode('code')}>코드 내용</button></div></div>
    <div className="search-meta">{hasWorkspace ? <>{lookup && <span className="lookup-filter">{lookup.scope ? `${lookup.scope}::` : ''}{lookup.term}{lookup.kind ? ` · ${filterLabel[lookup.kind]}` : ''}</span>}{status}</> : '먼저 소스 작업공간을 열어 주세요.'}</div>
    <div className="search-results">{results.map((r, i) => <button key={`${r.path}-${r.line}-${i}`} onClick={() => { onOpen(r.path, r.line); close(); }}>
      {r.symbol ? <Braces size={18}/> : <FileCode2 size={18}/>}
      <div><strong>{r.symbol ? <>{r.symbol.scope && <span className="symbol-scope">{r.symbol.scope}::</span>}{r.symbol.name}<em className={`symbol-kind ${r.symbol.kind}`}>{kindLabel[r.symbol.kind]}</em></> : basename(r.path)}{r.line && <small>L{r.line}</small>}</strong><span>{r.path}</span>{r.text && <code>{r.text}</code>}</div><ArrowUpRight size={15}/></button>)}
      {hasWorkspace && !searching && !results.length && <div className="small-empty">검색 결과가 없습니다.</div>}</div>
  </Modal>;
}
