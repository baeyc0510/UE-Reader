import { useState } from 'react';
import type { ConversationSettings as Settings } from '../../types';
export function ConversationSettings({ value, agentLabel, onChange }: { value: Settings; agentLabel: string; onChange: (next: Settings) => Promise<void> }) {
  const [count, setCount] = useState(String(value.historyCount)), [retain, setRetain] = useState(value.retainSession), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(next: Settings) {
    setBusy(true); setError(''); setRetain(next.retainSession);
    try { await onChange(next); setCount(String(next.historyCount)); } catch (e) { setError((e as Error).message); setCount(String(value.historyCount)); setRetain(value.retainSession); }
    finally { setBusy(false); }
  }
  return <div className="conversation-settings">
    <div className="setting-row"><label htmlFor="retain-session">{agentLabel} 세션 유지</label><input id="retain-session" type="checkbox" checked={retain} disabled={busy} onChange={e => save({ ...value, retainSession: e.target.checked })}/></div>
    <p className="field-help">켜면 채팅마다 에이전트 세션을 유지해 대화를 이어갑니다. 새 채팅은 새 세션으로 시작하고, 질문 영역의 세션 새로고침으로 현재 채팅의 세션만 새로 시작할 수 있습니다. 모드를 바꾸면 다음 질문부터 새 세션을 사용하며, 저장된 답변은 보존됩니다.</p>
    <div className="setting-row"><label htmlFor="history-count">세션 유지 OFF 시 이전 대화 개수</label><input id="history-count" type="number" min="0" max="50" step="1" value={count} disabled={retain || busy} onChange={e => setCount(e.target.value)} onBlur={() => {
      const n = Number(count);
      if (!count.trim() || !Number.isInteger(n) || n < 0 || n > 50) { setError('0~50 사이의 정수를 입력하세요.'); setCount(String(value.historyCount)); return; }
      if (n !== value.historyCount) save({ ...value, historyCount: n });
    }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/></div>
    <p className="field-help">같은 채팅의 질문과 답변 한 쌍을 1개로 셉니다. 0이면 이전 대화를 전달하지 않습니다. 이 설정은 저장된 기록을 삭제하지 않습니다.</p>
    {busy && <small>설정 저장 중…</small>}{error && <p className="model-warning" role="alert">{error}</p>}
  </div>;
}
