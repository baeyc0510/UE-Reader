// Global preferences: appearance, response instructions, agent roles, conversation mode, agent, model and extended thinking.
import { asyncRoute } from '../http/security.mjs';
import { fail } from '../source/source.mjs';
import { conversationSettings, selectedAgent, selectedModel, rolePrompts } from '../domain/settings.mjs';
import { DEFAULT_ROLE, DEFAULT_RESEARCH_ROLE } from '../analysis/prompts.mjs';

const MAX_ROLE = 6000;
const roleDefaults = { role: DEFAULT_ROLE, researchRole: DEFAULT_RESEARCH_ROLE };

export function settingsRoutes(app, { store, agents, runningJobs }) {
  app.get('/api/settings/instructions', (req, res) => res.json({ instructionPrompt: store.data.settings?.instructionPrompt || '' }));
  app.put('/api/settings/instructions', asyncRoute(async (req, res) => {
    const { instructionPrompt } = req.body;
    if (typeof instructionPrompt !== 'string' || instructionPrompt.length > 12000) throw fail('지침 프롬프트는 12,000자 이하의 텍스트로 입력하세요.');
    await store.update(d => { d.settings = { ...d.settings, instructionPrompt: instructionPrompt.trim() }; });
    res.json({ instructionPrompt: store.data.settings.instructionPrompt });
  }));
  // Role texts: empty or equal to the default stores '' so later default improvements still apply.
  app.get('/api/settings/roles', (req, res) => res.json({ ...rolePrompts(store), defaults: roleDefaults }));
  app.put('/api/settings/roles', asyncRoute(async (req, res) => {
    const { role, researchRole } = req.body;
    if (![role, researchRole].every(text => typeof text === 'string' && text.length <= MAX_ROLE)) throw fail(`역할 프롬프트는 각각 ${MAX_ROLE.toLocaleString('en-US')}자 이하의 텍스트로 입력하세요.`);
    const custom = (text, fallback) => text.trim() === fallback ? '' : text.trim();
    await store.update(d => { d.settings = { ...d.settings, rolePrompt: custom(role, DEFAULT_ROLE), researchRolePrompt: custom(researchRole, DEFAULT_RESEARCH_ROLE) }; });
    res.json({ ...rolePrompts(store), defaults: roleDefaults });
  }));
  app.put('/api/settings/appearance', asyncRoute(async (req, res) => {
    const { uiFont, codeFont, textSize, uiSize = store.data.settings?.appearance?.uiSize ?? 13 } = req.body;
    if (![uiFont, codeFont].every(f => typeof f === 'string' && f.trim().length > 0 && f.length <= 100) || ![12, 13, 14, 15, 16, 18, 20].includes(textSize)) throw fail('글꼴 이름과 글자 크기를 확인하세요.');
    if (![12, 13, 14, 15, 16, 18].includes(uiSize)) throw fail('앱 글자 크기를 확인하세요.');
    const appearance = { uiFont: uiFont.trim(), codeFont: codeFont.trim(), textSize, uiSize };
    await store.update(d => { d.settings = { ...d.settings, appearance }; });
    res.json(appearance);
  }));
  app.put('/api/settings/conversation', asyncRoute(async (req, res) => {
    const { retainSession, historyCount } = req.body;
    if (typeof retainSession !== 'boolean' || !Number.isInteger(historyCount) || historyCount < 0 || historyCount > 50) throw fail('대화 기록 개수는 0~50 사이의 정수로 입력하세요.');
    if (runningJobs().length) throw fail('진행 중인 요청을 완료하거나 취소한 뒤 설정을 바꾸세요.', 409);
    if (retainSession !== conversationSettings(store).retainSession) await agents.resetAllSessions();
    await store.update(d => { d.settings = { ...d.settings, retainSession, historyCount }; });
    res.json(conversationSettings(store));
  }));
  app.put('/api/settings/agent', asyncRoute(async (req, res) => {
    const { agent } = req.body;
    if (!agents.has(agent)) throw fail('지원하지 않는 에이전트입니다.');
    if (runningJobs().length) throw fail('진행 중인 요청을 완료하거나 취소한 뒤 에이전트를 바꾸세요.', 409);
    await store.update(d => { d.settings = { ...d.settings, agent }; });
    res.json({ agent, model: selectedModel(store, agent) });
  }));
  // Captured when a request starts, so toggling never affects a running one.
  app.put('/api/settings/extended-thinking', asyncRoute(async (req, res) => {
    if (typeof req.body.enabled !== 'boolean') throw fail('확장된 사고 사용 여부를 확인하세요.');
    await store.update(d => { d.settings = { ...d.settings, extendedThinking: req.body.enabled }; });
    res.json({ extendedThinking: req.body.enabled });
  }));
  // body: { model, agent? } — agent defaults to the selected one.
  app.put('/api/settings/model', asyncRoute(async (req, res) => {
    const agentId = req.body.agent || selectedAgent(store), agent = agents.get(agentId);
    const model = req.body.model === '' ? null : req.body.model ?? null;
    if (model !== null && (typeof model !== 'string' || !(await agent.catalog.accepts(model)))) throw fail('현재 모델 목록에서 선택하세요. 필요하면 목록을 새로고침하세요.');
    await store.update(d => { d.settings = { ...d.settings, models: { ...d.settings?.models, [agentId]: model } }; });
    res.json({ agent: agentId, model });
  }));
}
