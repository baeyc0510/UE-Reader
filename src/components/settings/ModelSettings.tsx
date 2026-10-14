import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '../../api/client';
import type { AgentInfo } from '../../types';

type Catalog = { models: { id: string; displayName: string; description: string; isDefault: boolean }[]; fetchedAt: string | null; cliVersion: string; stale: boolean; warning: string };

// Model choice for one agent, from the catalog its installed CLI reports at runtime.
export function ModelSettings({ agent, model, onChange }: { agent: AgentInfo; model: string | null; onChange: (value: string | null) => Promise<void> }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('');
  async function load(refresh = false) {
    setLoading(true); setError('');
    try { setCatalog(await api(`/agents/${agent.id}/models${refresh ? '?refresh=1' : ''}`)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true; setCatalog(null); setLoading(true);
    api<Catalog>(`/agents/${agent.id}/models`).then(result => { if (active) setCatalog(result); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [agent.id]);
  async function save(value: string | null) {
    setSaving(true); setError('');
    try { await onChange(value); } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  }
  const selected = catalog?.models.find(m => m.id === model), defaultModel = catalog?.models.find(m => m.isDefault);
  const unavailable = !!model && !!catalog && !catalog.stale && !selected;
  return <div className="model-settings">
    <div className="setting-row"><label htmlFor="agent-model">응답 모델</label><div className="model-picker"><select id="agent-model" value={model || ''} disabled={saving} onChange={e => void save(e.target.value || null)}>
      <option value="">{agent.label} 기본값{defaultModel ? ` · ${defaultModel.displayName}` : ''}</option>
      {model && !selected && <option value={model} disabled>{model} · {loading ? '조회 중' : '목록에서 확인되지 않음'}</option>}
      {catalog?.models.map(m => <option key={m.id} value={m.id}>{m.displayName}{m.isDefault ? ' · 권장 기본 모델' : ''}</option>)}
    </select><button className="icon-button" type="button" title="모델 목록 새로고침" aria-label="모델 목록 새로고침" disabled={loading} onClick={() => load(true)}>{loading ? <Loader2 size={15} className="spin"/> : <RefreshCw size={15}/>}</button></div></div>
    {selected?.description && <p className="field-help model-description">{selected.description}</p>}
    <p className="field-help">모든 작업공간의 다음 질문과 해설부터 적용됩니다. 모델 목록은 설치된 {agent.label}에서 로그인한 계정 기준으로 조회하며, CLI 버전이 바뀌거나 10분이 지나면 다시 불러옵니다.</p>
    {catalog?.fetchedAt && <p className="model-catalog-meta">{catalog.cliVersion} · {catalog.models.length}개 모델 · {new Date(catalog.fetchedAt).toLocaleString('ko-KR')}</p>}
    {unavailable && <p className="model-warning">선택한 모델이 현재 목록에 없습니다. 다음 요청은 {agent.label} 기본값을 사용하며, 기존 선택값은 보존합니다.</p>}
    {catalog?.warning && <p className="model-warning">{catalog.warning}</p>}{error && <p className="model-warning" role="alert">{error}</p>}
    {saving && <small className="model-catalog-meta">모델 설정 저장 중…</small>}
  </div>;
}
