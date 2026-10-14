import { useEffect, useState } from 'react';
import { api, json } from '../../api/client';

type Roles = { role: string; researchRole: string };
type Response = Roles & { defaults: Roles };
const fields = [
  { key: 'role', id: 'role-prompt', label: '답변·해설 역할', help: '답변, 코드 해설, 해설 검토에서 에이전트가 맡는 역할과 관점입니다.' },
  { key: 'researchRole', id: 'research-role-prompt', label: '탐색 에이전트 역할', help: '확장된 사고에서 먼저 코드를 조사하는 탐색 에이전트의 역할입니다.' },
] as const;

// Agent role texts. Empty on the server means the built-in default, which is shown here for editing.
export function RoleSettings() {
  const [text, setText] = useState<Roles>({ role: '', researchRole: '' }), [saved, setSaved] = useState<Roles>({ role: '', researchRole: '' }), [defaults, setDefaults] = useState<Roles>({ role: '', researchRole: '' });
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const apply = (data: Response) => { const shown = { role: data.role || data.defaults.role, researchRole: data.researchRole || data.defaults.researchRole }; setDefaults(data.defaults); setText(shown); setSaved(shown); };
  const load = () => {
    setLoading(true); setError('');
    api<Response>('/settings/roles').then(apply).catch(e => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);
  async function save(value: Roles, restored = false) {
    setBusy(true); setError(''); setMessage('');
    try { apply(await api<Response>('/settings/roles', json('PUT', value))); setMessage(restored ? '기본 역할로 복원했습니다.' : '저장했습니다. 다음 요청부터 적용됩니다.'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const changed = text.role !== saved.role || text.researchRole !== saved.researchRole;
  const isDefault = saved.role === defaults.role && saved.researchRole === defaults.researchRole;
  return <section className="instruction-settings role-settings">
    <p className="field-help">에이전트 지시문 맨 앞에 들어가는 역할 설명입니다. 비우거나 기본값과 같으면 기본 역할을 씁니다. 유지 중인 Codex 세션은 세션을 새로 시작한 뒤에 적용됩니다.</p>
    {fields.map(f => <div key={f.key} className="role-field">
      <label htmlFor={f.id}>{f.label}</label><p className="field-help">{f.help}</p>
      <textarea id={f.id} rows={5} maxLength={6000} value={text[f.key]} disabled={loading || busy} onChange={e => { setText(t => ({ ...t, [f.key]: e.target.value })); setMessage(''); }}/>
    </div>)}
    <div className="instruction-actions"><small>{changed ? '저장하지 않은 변경' : isDefault ? '기본 역할 사용 중' : '사용자 지정 역할'}</small><button className="secondary" disabled={loading || busy || (isDefault && !changed)} onClick={() => save({ role: '', researchRole: '' }, true)}>기본 역할로 복원</button><button className="primary" disabled={loading || busy || !changed} onClick={() => save(text)}>{busy ? '저장 중…' : '역할 저장'}</button></div>
    {message && <p role="status">{message}</p>}{error && <p className="model-warning" role="alert">{error} <button onClick={load}>다시 불러오기</button></p>}
  </section>;
}
