import { Check, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import type { CodeIndexStatus } from '../../types';

const steps = ['앱 서버 연결', '작업공간과 설정 불러오기', '화면 준비'];

// Required start-up steps. Anything slow after this (file list, code index) loads in the background.
export function BootScreen({ step, error }: { step: number; error: string }) {
  return <main className="welcome boot-screen" role="status" aria-live="polite">
    <h2>UE Reader를 준비하는 중입니다</h2>
    <ol className="boot-steps">{steps.map((label, i) => <li key={label} className={i < step ? 'done' : i === step ? (error ? 'failed' : 'current') : ''}>
      {i < step ? <Check size={15}/> : i === step ? (error ? <TriangleAlert size={15}/> : <Loader2 size={15} className="spin"/>) : <span className="boot-dot"/>}{label}</li>)}</ol>
    {error && <><p className="boot-error">{error}</p><button className="primary" onClick={() => location.reload()}><RefreshCw size={15}/>다시 시도</button></>}
  </main>;
}

// First build of a large workspace's code index: reading works now; navigation and fast search follow.
export function IndexBanner({ status }: { status: CodeIndexStatus }) {
  const percent = status.total ? Math.floor(status.processed / status.total * 100) : 0;
  return <div className="index-banner" role="status">
    <Loader2 size={13} className="spin"/>
    <span><b>코드 인덱스를 처음 만드는 중입니다 · {percent}%</b>{status.total ? ` (${status.processed.toLocaleString()} / ${status.total.toLocaleString()}개 파일)` : ' (파일 목록 확인 중)'} — 소스와 해설은 지금 읽을 수 있고, 정의 이동·심볼 검색·빠른 코드 검색은 완료 후 사용할 수 있습니다. 다음 실행부터는 저장된 인덱스를 바로 사용합니다.</span>
    <span className="index-progress-bar"><i style={{ width: `${percent}%` }}/></span>
  </div>;
}
