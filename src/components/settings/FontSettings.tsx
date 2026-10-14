import { useState } from 'react';
import { defaultAppearance, fontStack, type Appearance } from '../../lib/appearance';

export function FontSettings({ value, onChange }: { value: Appearance; onChange: (next: Appearance) => Promise<void> }) {
  const [draft, setDraft] = useState(value), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const change = (patch: Partial<Appearance>) => { setDraft(v => ({ ...v, ...patch })); setSaved(false); };
  async function save(next: Appearance) {
    setBusy(true); setError('');
    try { await onChange(next); setDraft(next); setSaved(true); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="font-settings">
    <div className="setting-row"><label htmlFor="ui-font">화면·해설 글꼴</label><input id="ui-font" list="ui-fonts" maxLength={100} value={draft.uiFont} disabled={busy} onChange={e => change({ uiFont: e.target.value })}/><datalist id="ui-fonts">{['Segoe UI', 'Malgun Gothic', 'Gulim', 'Batang', 'Arial', 'Noto Sans KR', 'Pretendard'].map(name => <option key={name} value={name}/>)}</datalist></div>
    <div className="setting-row"><label htmlFor="code-font">코드 글꼴</label><input id="code-font" list="code-fonts" maxLength={100} value={draft.codeFont} disabled={busy} onChange={e => change({ codeFont: e.target.value })}/><datalist id="code-fonts">{['Consolas', 'Cascadia Code', 'Cascadia Mono', 'D2Coding', 'JetBrains Mono', 'Courier New'].map(name => <option key={name} value={name}/>)}</datalist></div>
    <p className="field-help">설치된 글꼴 이름을 직접 입력할 수 있습니다. 코드에는 고정폭 글꼴을 권장합니다. 없는 글꼴은 기본 글꼴로 표시됩니다.</p>
    <div className="setting-row"><label htmlFor="app-font-size">앱 글자 크기</label><select id="app-font-size" disabled={busy} value={draft.uiSize} onChange={e => change({ uiSize: +e.target.value })}>{[12, 13, 14, 15, 16, 18].map(n => <option key={n} value={n}>{n}px{n === 13 ? ' (기본)' : ''}</option>)}</select></div>
    <p className="field-help">앱 글자 크기는 탐색기, 탭, 메뉴, 설정에 적용합니다. 코드와 해설·답변 크기는 따로 조절합니다.</p>
    <div className="setting-row"><label htmlFor="reading-font-size">해설·답변 글자 크기</label><select id="reading-font-size" disabled={busy} value={draft.textSize} onChange={e => change({ textSize: +e.target.value })}>{[12, 13, 14, 15, 16, 18, 20].map(n => <option key={n} value={n}>{n}px</option>)}</select></div>
    <div className="font-preview" style={{ fontFamily: fontStack(draft.uiFont), fontSize: draft.textSize }}><p>함수의 역할을 이해하고 중요한 처리 과정을 자세히 읽습니다.</p><code style={{ fontFamily: fontStack(draft.codeFont, true) }}>if (bReady) AnalyzeReferences(Context);</code></div>
    <div className="instruction-actions"><span className="field-help">모든 작업공간에 적용합니다.</span><button className="secondary" disabled={busy} onClick={() => save(defaultAppearance)}>기본 글꼴 복원</button><button className="primary" disabled={busy || !draft.uiFont.trim() || !draft.codeFont.trim()} onClick={() => save(draft)}>{busy ? '저장 중…' : '글꼴 적용'}</button></div>
    {saved && <p role="status">글꼴 설정을 저장했습니다.</p>}{error && <p role="alert" className="model-warning">{error}</p>}
  </section>;
}
