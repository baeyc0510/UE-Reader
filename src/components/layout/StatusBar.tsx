import { Check, Database, Loader2, ShieldCheck } from 'lucide-react';
import type { CodeIndexStatus, Workspace } from '../../types';

const count = (n?: number) => (n ?? 0).toLocaleString();
function indexLabel(s: CodeIndexStatus) {
  if (s.status === 'building' || s.status === 'loading') return s.total ? `코드 인덱스 빌드 ${Math.floor(s.processed / s.total * 100)}%` : '코드 인덱스 준비 중';
  if (s.status === 'updating') return `코드 인덱스 갱신 중 · 심볼 ${count(s.symbols)}`;
  if (s.status === 'error') return '코드 인덱스 오류 · 클릭해 다시 시도';
  return `코드 인덱스 · 심볼 ${count(s.symbols)}`;
}

export function StatusBar({ workspace, visibleLine, saveState, onRetrySave, codeIndex, onRefreshIndex }: { workspace?: Workspace; visibleLine: number; saveState: string; onRetrySave: () => void; codeIndex: CodeIndexStatus | null; onRefreshIndex: () => void }) {
  const busy = codeIndex && codeIndex.status !== 'ready' && codeIndex.status !== 'error';
  return <footer className="statusbar">
    <div><span className="local-dot"/>LOCAL WORKSPACE<span className="status-divider"/>{workspace ? workspace.demo ? '예제 작업공간' : `UE ${workspace.version}` : '소스 폴더 미지정'}</div>
    <div>{codeIndex && <><button className="code-index-status" onClick={onRefreshIndex} title={`${count(codeIndex.files)}개 파일 · 토큰 ${count(codeIndex.tokens)}${codeIndex.builtAt ? ` · ${new Date(codeIndex.builtAt).toLocaleString('ko-KR')} 기준` : ''}${codeIndex.error ? ` · ${codeIndex.error}` : ''}\n클릭: 바뀐 파일만 다시 인덱싱`}>{busy ? <Loader2 size={11} className="spin"/> : <Database size={11}/>} {indexLabel(codeIndex)}</button><span className="status-divider"/></>}
      {workspace && <span>Ln {visibleLine}</span>}<span className="status-divider"/>
      <button onClick={onRetrySave} className={saveState === '저장 실패' ? 'save-error' : ''}>{saveState === '저장 중' ? <Loader2 size={11} className="spin"/> : <Check size={11}/>} {saveState}{saveState === '저장 실패' && ' · 재시도'}</button><ShieldCheck size={12}/></div>
  </footer>;
}
