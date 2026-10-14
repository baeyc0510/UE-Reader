import { useState } from 'react';
import { Loader2, Power } from 'lucide-react';
import { Modal } from '../common/Modal';

export function RenameModal({ title, label, initial, close, onSave }: { title: string; label: string; initial: string; close: () => void; onSave: (value: string) => Promise<void> }) {
  const [value, setValue] = useState(initial);
  return <Modal title={title} close={close}><form className="modal-body" onSubmit={async e => { e.preventDefault(); await onSave(value); close(); }}>
    <label className="field-label">{label}<input autoFocus value={value} maxLength={160} onChange={e => setValue(e.target.value)}/></label>
    <button type="submit" className="primary full" disabled={!value.trim()}>저장</button>
  </form></Modal>;
}

export function ShutdownModal({ running, busy, error, close, onShutdown }: { running: boolean; busy: boolean; error: string; close: () => void; onShutdown: () => void }) {
  return <Modal title="앱 종료" close={() => { if (!busy) close(); }}><div className="modal-body">
    <p>작성 중인 질문과 화면 상태를 저장한 뒤 앱을 종료합니다.</p>
    {!window.ueReader && <p className="field-help">열려 있는 다른 UE Reader 탭도 서버 연결이 끊어집니다.</p>}
    {running && <p role="status">진행 중인 질문·해설을 완료하거나 취소한 뒤 종료하세요.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="shutdown-actions"><button className="secondary" disabled={busy} onClick={close}>계속 사용</button><button className="primary" disabled={busy} onClick={onShutdown}>{busy ? <Loader2 size={16} className="spin"/> : <Power size={16}/>}{running ? '작업 취소하고 종료' : '저장하고 종료'}</button></div>
  </div></Modal>;
}
