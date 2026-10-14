import { useState } from 'react';
import { Power } from 'lucide-react';
import { Reader } from './Reader';

export function App() {
  const [stopped, setStopped] = useState(false);
  return stopped ? <main className="welcome app-stopped"><Power size={36}/><h1>UE Reader를 종료했습니다.</h1><p>이 브라우저 탭을 닫아도 됩니다.<br/>다시 사용하려면 바탕화면의 UE Reader 실행 바로가기를 여세요.</p></main> : <Reader onStopped={() => setStopped(true)}/>;
}
