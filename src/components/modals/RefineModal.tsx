import { useEffect, useState } from 'react';
import { FileCode2, Search, Wand2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { api } from '../../api/client';
import { basename, date } from '../../lib/format';
import type { NoteFile } from '../../types';

export const MAX_REFINE_FILES = 10;
export type RefineRequest = { paths: string[]; question: string; allowAdd: boolean; allowDelete: boolean };
type Props = { workspaceId: string; initial: RefineRequest; running: boolean; report: (e: unknown) => void; close: () => void; onStart: (request: RefineRequest) => void };

const examples = ['초보자도 이해할 수 있게 배경 개념을 보강해 주세요.', '중복되는 설명을 합치고 핵심 흐름 위주로 간결하게 정리해 주세요.', '스레드 안전성과 수명 관리 관점을 더 자세히 설명해 주세요.'];

// Ask the agent to revise saved explanations of several files with the user's own request.
export function RefineModal({ workspaceId, initial, running, report, close, onStart }: Props) {
  const [files, setFiles] = useState<NoteFile[]>([]), [filter, setFilter] = useState('');
  const [request, setRequest] = useState(initial);
  useEffect(() => { api<NoteFile[]>(`/workspaces/${workspaceId}/notes/files`).then(setFiles).catch(report); }, [workspaceId]);
  const shown = files.filter(f => f.path.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (path: string) => setRequest(r => ({ ...r, paths: r.paths.includes(path) ? r.paths.filter(p => p !== path) : [...r.paths, path] }));
  const tooMany = request.paths.length > MAX_REFINE_FILES;
  return <Modal title="해설 다듬기" close={close} wide>
    <form className="modal-body refine-form" onSubmit={e => { e.preventDefault(); if (request.paths.length && !tooMany && !running) { onStart(request); close(); } }}>
      <div className="refine-files-head"><strong>다듬을 파일</strong><span>{request.paths.length}개 선택 · 최대 {MAX_REFINE_FILES}개</span>
        <label className="refine-filter"><Search size={13}/><input aria-label="파일 필터" placeholder="파일 필터" value={filter} onChange={e => setFilter(e.target.value)}/></label></div>
      <div className="refine-files" role="group" aria-label="다듬을 파일">
        {shown.map(f => <label key={f.path} title={f.path} className={request.paths.includes(f.path) ? 'checked' : ''}>
          <input type="checkbox" checked={request.paths.includes(f.path)} onChange={() => toggle(f.path)}/><FileCode2 size={15}/>
          <span><strong>{basename(f.path)}</strong><small>{f.path}</small></span><em>{f.count}개 해설 · {date(f.updatedAt)}</em>
        </label>)}
        {!files.length && <p className="small-empty">저장한 해설이 없습니다.</p>}
      </div>
      <label className="field-label">어떻게 다듬을까요?
        <textarea className="refine-request" aria-label="다듬기 요청" rows={4} maxLength={8000} placeholder={'비워 두면 더 이해하기 쉽고 정확하게 다듬습니다.\n예) ' + examples[0]} value={request.question} onChange={e => setRequest(r => ({ ...r, question: e.target.value }))}/>
      </label>
      <div className="refine-examples">{examples.map(text => <button type="button" key={text} onClick={() => setRequest(r => ({ ...r, question: text }))}>{text}</button>)}</div>
      <div className="refine-options">
        <label><input type="checkbox" checked={request.allowAdd} onChange={e => setRequest(r => ({ ...r, allowAdd: e.target.checked }))}/><span><strong>필요하면 해설 추가</strong><small>빠진 중요한 구간이 있거나 나누는 편이 좋을 때 새 해설을 만듭니다.</small></span></label>
        <label><input type="checkbox" checked={request.allowDelete} onChange={e => setRequest(r => ({ ...r, allowDelete: e.target.checked }))}/><span><strong>불필요한 해설 삭제</strong><small>중복되거나 사소한 해설을 지웁니다. 완료 후 되돌릴 수 있습니다.</small></span></label>
      </div>
      <p className="field-help">에이전트가 현재 소스를 다시 읽고 요청과 옵션에 따라 무엇을 고칠지 스스로 판단합니다. 수정한 해설은 새 버전으로 저장되고 이전 버전은 남습니다.</p>
      {tooMany && <p role="alert" className="warning-text">한 번에 최대 {MAX_REFINE_FILES}개 파일을 다듬을 수 있습니다.</p>}
      <button type="submit" className="primary full" disabled={!request.paths.length || tooMany || running}><Wand2 size={15}/>{running ? '진행 중인 요청이 있습니다' : '다듬기 시작'}</button>
    </form>
  </Modal>;
}
