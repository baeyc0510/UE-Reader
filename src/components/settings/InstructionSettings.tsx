import { useEffect, useState } from 'react';
import { api, json } from '../../api/client';

export function InstructionSettings() {
  const [text, setText] = useState(''), [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const load = () => {
    setLoading(true); setError('');
    api('/settings/instructions').then(data => { setText(data.instructionPrompt); setSaved(data.instructionPrompt); }).catch(e => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);
  async function save(value: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await api('/settings/instructions', json('PUT', { instructionPrompt: value }));
      setText(data.instructionPrompt); setSaved(data.instructionPrompt); setMessage(value.trim() ? '저장했습니다. 다음 요청부터 적용됩니다.' : '기본 지침으로 복원했습니다.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="instruction-settings">
    <label htmlFor="instruction-prompt">지침 프롬프트</label>
    <p className="field-help">답변과 코드 해설의 말투, 설명 수준, 형식 등을 지정하세요. 모든 작업공간의 다음 요청부터 적용하며, 유지 중인 세션에도 적용합니다.</p>
    <textarea id="instruction-prompt" rows={6} maxLength={12000} value={text} disabled={loading || busy} onChange={e => { setText(e.target.value); setMessage(''); }} placeholder="예: 핵심 결론부터 설명하고, 초보자가 이해할 수 있도록 용어를 풀어 써 주세요."/>
    <div className="instruction-actions"><small>{text.length.toLocaleString()} / 12,000자{text !== saved ? ' · 저장하지 않은 변경' : ''}</small><button className="secondary" disabled={loading || busy || (!text && !saved)} onClick={() => save('')}>기본값으로 복원</button><button className="primary" disabled={loading || busy || text === saved} onClick={() => save(text)}>{busy ? '저장 중…' : '지침 저장'}</button></div>
    {message && <p role="status">{message}</p>}{error && <p className="model-warning" role="alert">{error} <button onClick={load}>다시 불러오기</button></p>}
  </section>;
}
