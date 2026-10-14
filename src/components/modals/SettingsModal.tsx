import { FolderOpen } from 'lucide-react';
import { Modal } from '../common/Modal';
import { FontSettings } from '../settings/FontSettings';
import { ConversationSettings } from '../settings/ConversationSettings';
import { InstructionSettings } from '../settings/InstructionSettings';
import { RoleSettings } from '../settings/RoleSettings';
import { ModelSettings } from '../settings/ModelSettings';
import { AgentSettings } from '../settings/AgentSettings';
import type { Appearance } from '../../lib/appearance';
import type { AgentInfo, AgentStatus, ConversationSettings as ConversationOptions, Session, Workspace } from '../../types';
import type { SessionUpdate } from '../../hooks/useWorkspaceSession';

type Props = {
  session: Session; update: (change: SessionUpdate) => void; appearance: Appearance; onAppearance: (value: Appearance) => Promise<void>;
  conversation: ConversationOptions; onConversation: (value: ConversationOptions) => Promise<void>;
  agents: AgentInfo[]; agent: AgentInfo; status: AgentStatus; onAgent: (id: string) => Promise<void>; onCheckStatus: () => void;
  model: string | null; onModel: (value: string | null) => Promise<void>;
  dataDir: string; workspace?: Workspace; onRelocate: () => void; close: () => void;
};

export function SettingsModal(p: Props) {
  const { session, update } = p;
  return <Modal wide title="작업공간 설정" close={p.close}><div className="modal-body settings-body">
    <h3>AI 에이전트와 모델</h3><AgentSettings agents={p.agents} agent={p.agent} status={p.status} onChange={p.onAgent} onCheck={p.onCheckStatus}/>
    <ModelSettings key={p.agent.id} agent={p.agent} model={p.model} onChange={p.onModel}/>
    <h3>글꼴</h3><FontSettings value={p.appearance} onChange={p.onAppearance}/>
    <h3>읽기 환경</h3>
    <div className="setting-row"><label htmlFor="theme">화면 테마</label><select id="theme" value={session.theme} onChange={e => update({ theme: e.target.value as Session['theme'] })}><option value="light">밝게</option><option value="dark">어둡게</option></select></div>
    <div className="setting-row"><label htmlFor="font">코드 글자 크기</label><select id="font" value={session.fontSize} onChange={e => update({ fontSize: +e.target.value })}>{[12, 13, 14, 15, 16, 18].map(n => <option key={n} value={n}>{n}px</option>)}</select></div>
    <div className="setting-row"><label htmlFor="wrap">코드 자동 줄바꿈</label><input id="wrap" type="checkbox" checked={session.wrap} onChange={e => update({ wrap: e.target.checked })}/></div>
    <div className="setting-row"><label htmlFor="detail">해설 길이</label><select id="detail" value={session.detail} onChange={e => update({ detail: e.target.value as Session['detail'] })}><option value="normal">기본 · 강의처럼 충분히</option><option value="brief">간결하게</option></select></div>
    <h3>대화 설정</h3><ConversationSettings value={p.conversation} agentLabel={p.agent.label} onChange={p.onConversation}/>
    <h3>응답 지침</h3><InstructionSettings/>
    <h3>에이전트 역할</h3><RoleSettings/>
    <h3>로컬 저장소</h3><p className="data-path">{p.dataDir}</p>
    {p.workspace && <button className="secondary full" onClick={p.onRelocate}><FolderOpen size={15}/>소스 폴더 다시 연결</button>}
    <h3>키보드 단축키</h3><div className="shortcuts"><span>빠른 검색<kbd>Ctrl P</kbd></span><span>파일 내 검색<kbd>Ctrl F</kbd></span><span>스크롤 연결<kbd>Ctrl Shift L</kbd></span><span>질문 보내기<kbd>Ctrl Enter</kbd></span><span>탐색 뒤로 / 앞으로<kbd>Alt ← / →</kbd></span><span>탭 전환<kbd>Ctrl PageUp / Down</kbd></span><span>채팅 메뉴<kbd>우클릭 · Shift F10</kbd></span></div>
  </div></Modal>;
}
