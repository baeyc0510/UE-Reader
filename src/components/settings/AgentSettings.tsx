import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { AgentInfo, AgentStatus } from '../../types';

// Which agent CLI answers questions and writes explanations, with its login state.
export function AgentSettings({ agents, agent, status, onChange, onCheck }: { agents: AgentInfo[]; agent: AgentInfo; status: AgentStatus; onChange: (id: string) => Promise<void>; onCheck: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function change(id: string) {
    setBusy(true); setError('');
    try { await onChange(id); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="agent-settings">
    <div className="setting-row"><label htmlFor="agent">응답 에이전트</label><select id="agent" value={agent.id} disabled={busy} onChange={e => change(e.target.value)}>{agents.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
    <div className="connection-box"><span className={`status-dot ${status.authenticated ? 'green' : ''}`}/><span>{status.message}</span><button onClick={onCheck}><RefreshCw size={14}/>확인</button></div>
    <p className="field-help">로컬에 설치된 {agent.label}와 기존 로그인을 사용합니다. 연결되지 않으면 터미널에서 <code>{agent.loginHint}</code>를 실행해 로그인하세요. 모든 에이전트는 읽기 전용 소스 도구와 웹 검색만 사용하며, 요청 시 선택한 코드가 해당 서비스에 전달됩니다.</p>
    {error && <p className="model-warning" role="alert">{error}</p>}
  </section>;
}
