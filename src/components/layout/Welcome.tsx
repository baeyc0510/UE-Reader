import { ArrowUpRight, BookOpen, Code2, FolderOpen, Link2, Loader2, ShieldCheck } from 'lucide-react';

// Shown when no source workspace is open (the question panel sits beside it).
export function Welcome({ connecting, onOpen, onDemo }: { connecting: boolean; onOpen: () => void; onDemo: () => void }) {
  return <section className="welcome">
    <div className="welcome-art"><Code2 size={48}/><span className="art-line"/><BookOpen size={42}/></div>
    <span className="eyebrow">UNREAL ENGINE, LINE BY LINE</span><h1>코드 옆에서, 엔진을 이해하다.</h1><p>원본 소스와 해설을 한눈에 읽고<br/>다음 분석에서도 이어서 탐색하세요.</p>
    <div className="welcome-actions"><button className="primary" onClick={onOpen}><FolderOpen size={17}/>소스 폴더 열기</button><button className="secondary" onClick={onDemo} disabled={connecting}>{connecting ? <Loader2 className="spin" size={16}/> : <ArrowUpRight size={16}/>}예제로 둘러보기</button></div>
    <div className="welcome-facts"><span><ShieldCheck size={15}/>원본은 읽기 전용</span><span><BookOpen size={15}/>해설은 로컬에 저장</span><span><Link2 size={15}/>코드와 해설 연결</span></div>
    <div className="welcome-note">예제는 직접 작성한 액터 코드입니다. 실제 Unreal Engine 소스는 포함하지 않습니다.</div>
  </section>;
}
