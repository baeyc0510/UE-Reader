// POST /api/workspaces/:id/generate — one agent request, end to end:
//   parseRequest → collectContexts → (chat) → run agent in background → normalize → persist.
// Extended thinking (settings.extendedThinking, see extended.mjs) adds a research pass before the
// agent run and, for explanations, a review pass before saving.
// Kinds: question (chat answer; also notes when the user asks in chat for explanations and the agent picks the files),
// overview / explain (file notes), answer-explain (notes from an answer),
// refine (revise saved notes of several files; see refine.mjs).
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readSource, sourceScope, searchScopePaths, fail } from '../source/source.mjs';
import { readAudit } from '../agents/process.mjs';
import { createSourceTools } from '../agents/source-tools.mjs';
import { isQuestion, chatHistory } from '../domain/conversations.mjs';
import { createChat, findChat, applyAnswerTitle } from '../domain/chats.mjs';
import { conversationSettings, selectedAgent, selectedModel, instructionPrompt, extendedThinking, rolePrompts } from '../domain/settings.mjs';
import { analysisInstructions, buildRequestPrompt, buildReviewPrompt, researchInstructions, reviewInstructions, changedSourceNotice, PROMPT_VERSION } from './prompts.mjs';
import { questionSchema, explanationSchema, refineSchema, researchSchema } from './schemas.mjs';
import { RESEARCH_LIMITS, normalizeResearch, researchExcerpts, excerptsFor, draftForReview, applyReview } from './extended.mjs';
import { refineRequest, existingForPrompt, planRefinement, applyRefinement } from './refine.mjs';
import { validateShape, normalizeSections, normalizeSuggestedFiles, normalizeWebSources, normalizeDiagrams, attachRevisions } from './results.mjs';

const KINDS = ['overview', 'explain', 'question', 'answer-explain', 'refine'];
const MAX_RANGES = 12, MAX_CHARS = 100000;

export function publicJob(j) {
  const { controller, child, save, ...rest } = j;
  return rest;
}

async function parseRequest({ store, w, body, attachments }) {
  const kind = KINDS.includes(body.kind) ? body.kind : 'explain';
  // Where the agent's search tools look by default; empty means the whole workspace.
  const searchScope = w.root ? await searchScopePaths(w, body.searchScope) : [];
  if (kind === 'refine') {
    const refine = await refineRequest({ store, w, body });
    return { kind, questionMode: false, fromAnswer: false, origin: null, question: String(body.question || '').trim().slice(0, 8000), target: null, raw: refine.raw, chatId: null, refine, searchScope };
  }
  const questionMode = kind === 'question', fromAnswer = kind === 'answer-explain';
  const referenceId = fromAnswer ? body.conversationId : questionMode ? body.referenceConversationId : null;
  const origin = referenceId ? store.data.conversations.find(c => c.id === referenceId && c.workspaceId === w.id && c.status === 'complete' && isQuestion(c)) : null;
  if (referenceId && !origin) throw fail(fromAnswer ? '해설로 이어갈 완료된 답변을 찾을 수 없습니다.' : '참고할 완료된 답변을 찾을 수 없습니다.');
  if (fromAnswer && !w.root) throw fail('코드 해설을 만들려면 소스 작업공간을 먼저 연결하세요.');
  const question = String(body.question || '').trim().slice(0, 8000);
  if (questionMode && !question) throw fail('질문을 입력하세요.');
  if (!questionMode && !fromAnswer && (!w.root || !body.path)) throw fail('해설을 생성할 파일을 선택하세요.');
  const target = !questionMode && w.root && body.path ? await readSource(w, body.path) : null;
  // A file explanation without a selection starts from the top of the file; the agent reads further as needed.
  const raw = Array.isArray(body.contexts) && body.contexts.length ? body.contexts : target && !fromAnswer ? [{ path: target.path, start: 1, end: Math.min(target.lines, 180) }] : [];
  if (raw.length > MAX_RANGES) throw fail(`한 번에 최대 ${MAX_RANGES}개 코드 범위를 선택하세요.`);
  if (!w.root && raw.length) throw fail('소스 작업공간을 먼저 지정하세요.');
  if (questionMode && body.chatId) findChat(store.data, body.chatId);
  // Attached files (outside-workspace documents the user picked) go with questions only.
  const files = questionMode ? attachments?.resolve(body.attachments) || [] : [];
  return { kind, questionMode, fromAnswer, origin, question, target, raw, files, searchScope, chatId: questionMode ? body.chatId || origin?.chatId || null : null };
}

async function collectContexts({ w, target, raw, questionMode, fromAnswer, refine }) {
  const context = [];
  const addContext = c => { if (!context.some(old => old.path === c.path && old.start === c.start && old.end === c.end && old.hash === c.hash)) context.push(c); };
  let totalChars = 0;
  for (const item of raw) {
    const source = item.path === target?.path ? target : await readSource(w, item.path);
    const start = Number(item.start), end = Number(item.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > source.lines) throw fail('선택한 라인 범위가 현재 소스와 다릅니다. 다시 선택하세요.');
    const text = source.text.split('\n').slice(start - 1, end).join('\n'); totalChars += text.length;
    addContext({ path: source.path, start, end, text, hash: source.hash });
  }
  if (!questionMode && !fromAnswer && !refine && !context.some(c => c.path === target.path)) throw fail('현재 파일의 코드 범위를 하나 이상 포함하세요.');
  if (totalChars > MAX_CHARS) throw fail('선택한 코드가 너무 큽니다. 100,000자 이하로 범위를 줄이세요.');
  return { context, addContext };
}

export function generationHandler({ store, workspace, getIndex, jobs, dataDir, agents, attachments, agentIndex }) {
  let preparing = false;
  const busy = () => preparing || [...jobs.values()].some(j => j.status === 'running');
  return async (req, res) => {
    if (busy()) throw fail('진행 중인 요청을 완료하거나 취소하세요.', 409);
    preparing = true;
    try {
      const w = workspace(req.params.id);
      const request = await parseRequest({ store, w, body: req.body, attachments });
      const { kind, questionMode, fromAnswer, origin, question, target, raw } = request;
      const { context, addContext } = await collectContexts({ w, ...request });
      const id = randomUUID();
      // Capture choices now; changing settings only affects subsequent requests.
      const agentId = selectedAgent(store), agent = agents.get(agentId);
      const requestedModel = selectedModel(store, agentId);
      const settings = conversationSettings(store), retainSession = questionMode && settings.retainSession;
      let chatId = request.chatId;
      if (questionMode && !chatId) chatId = await store.update(d => createChat(d, { workspaceId: w.id, question }).id);
      // A retained session already holds the chat's history, unless this agent starts a fresh one.
      const live = store.data.agentSessions?.[chatId];
      const history = questionMode && (!retainSession || !live || live.provider !== agentId) ? chatHistory(store.data.conversations, chatId, settings.historyCount) : [];
      const paths = request.refine?.paths || [];
      const job = { id, workspaceId: w.id, chatId, agent: agentId, retainSession, requestPath: target?.path || '', path: target?.path || paths[0] || '', paths, kind, sourceConversationId: origin?.id, question, requestedModel, model: requestedModel, modelNotice: '',
        status: 'running', stage: `${agent.label} 연결 중`, partial: '', controller: new AbortController(), context, activity: [], suggestedFiles: [], webSources: [], createdAt: new Date().toISOString() };
      jobs.set(id, job);
      const roles = rolePrompts(store);
      const instructions = analysisInstructions({ questionMode, fromAnswer, workspace: w, target, kind, refine: request.refine, roles });
      // The prompt is built once research (if any) is done; `context` is copied because reads extend it.
      const promptArgs = { instructionPrompt: instructionPrompt(store), question: request.refine && !question ? '해설을 더 이해하기 쉽고 정확하게 다듬어 주세요.' : question, detail: req.body.detail, history, origin, context: [...context], existing: request.refine && existingForPrompt(request.refine), attachments: request.files, searchScope: request.searchScope };
      job.extended = !request.refine && extendedThinking(store);
      // The MCP source tools query the app's indexes over loopback with a token valid for this request only.
      const indexAccess = w.root && agentIndex ? { url: `http://127.0.0.1:${req.socket.localPort}/api/agent-index`, token: agentIndex.grant(w.id) } : null;
      void execute({ store, w, job, agent, request, context, addContext, instructions, roles, promptArgs, raw, dataDir, getIndex, agentIndex, indexAccess, noteId: req.body.noteId });
      res.status(202).json(publicJob(job));
    } finally { preparing = false; }
  };
}

async function execute({ store, w, job, agent, request, context, addContext, instructions, roles, promptArgs, raw, dataDir, getIndex, agentIndex, indexAccess, noteId }) {
  const { kind, questionMode, origin, question, target, refine, searchScope } = request;
  const attachedFiles = (request.files || []).map(({ name, pages, chars, truncated }) => ({ name, pages, chars, truncated }));
  const jobDir = path.join(dataDir, 'requests', job.id);
  const onEvent = ({ activity, ...event }) => {
    Object.assign(job, event);
    if (!activity) return;
    const old = activity.id ? job.activity.find(a => a.id === activity.id) : null;
    if (old) Object.assign(old, activity); else job.activity.push({ ...activity, time: new Date().toISOString() });
  };
  // Prior inspected code is valid evidence only while the source hash still matches.
  const onSession = async session => {
    job.sessionId = session.id;
    const previous = store.data.conversations.filter(c => c.workspaceId === w.id && c.sessionId === session.id).at(-1);
    const sources = new Map(), changed = new Set();
    for (const c of (previous?.context || []).slice(-128)) {
      if (!w.root) break;
      if (!sources.has(c.path)) sources.set(c.path, await readSource(w, c.path).catch(() => null));
      if (sources.get(c.path)?.hash === c.hash) addContext(c); else changed.add(c.path);
    }
    return changed.size ? changedSourceNotice([...changed]) : '';
  };
  const scope = w.root ? sourceScope(w) : null, signal = job.controller.signal, extendedWarnings = [];
  // In-process equivalent of the MCP tools, injectable for deterministic integration tests.
  const toolsFor = limits => createSourceTools(scope, { onRead: addContext, index: w.root ? getIndex(w) : undefined, limits, searchScope, codeIndex: w.root && agentIndex ? agentIndex.local(w.id) : null });
  // Extended thinking runs extra stateless passes. Their activity ids are prefixed (CLIs may reuse ids
  // across runs) and their partial JSON is not shown as the answer.
  const phase = (name, detail, status) => onEvent({ ...(status === 'running' ? { stage: detail } : {}), activity: { id: `${name}:phase`, type: 'status', tool: 'phase', detail, status } });
  const extraPass = async (name, label, { prompt, instructions, responseSchema, limits }) => {
    const directory = path.join(jobDir, name);
    try {
      return await agent.run({ directory, prompt, instructions, mode: name, responseSchema, model: job.model, workspaceId: w.id, sourceRoot: scope, sourceLimits: limits, searchScope, indexAccess, signal, onContext: addContext,
        sourceTools: toolsFor(limits), onProcess: child => { job.child = child; },
        onEvent: ({ activity, partial, stage, ...event }) => onEvent({ ...event, ...(stage ? { stage: `${label} · ${stage}` } : {}), ...(activity ? { activity: { ...activity, id: activity.id && `${name}:${activity.id}` } } : {}) }) });
    } finally { for (const c of await readAudit(directory)) addContext(c); }
  };
  try {
    Object.assign(job, await agent.catalog.resolveModel(job.requestedModel));
    if (signal.aborted) throw Error('요청이 취소되었습니다.');
    let research = null;
    if (job.extended) {
      phase('research', '확장된 사고 · 탐색 에이전트가 관련 코드를 넓게 조사하는 중', 'running');
      try {
        const found = await extraPass('research', '탐색 에이전트', { prompt: buildRequestPrompt(promptArgs), instructions: researchInstructions({ questionMode, workspace: w, target, calls: RESEARCH_LIMITS.calls, roles }), responseSchema: researchSchema, limits: RESEARCH_LIMITS });
        const notes = normalizeResearch(found, context);
        research = { notes, excerpts: researchExcerpts(notes, context) };
        phase('research', `확장된 사고 · 탐색 완료: 조사 결과 ${notes.findings.length}개`, 'complete');
      } catch (e) {
        if (signal.aborted) throw e;
        extendedWarnings.push(`확장된 사고의 탐색 단계를 완료하지 못해 일반 방식으로 진행했습니다: ${e.message}`);
        phase('research', '확장된 사고 · 탐색 실패, 일반 방식으로 진행', 'failed');
      }
      job.research = research?.notes || null;
    }
    const prompt = buildRequestPrompt({ ...promptArgs, research });
    const runtimeModel = job.retainSession && !job.model && agent.id === 'codex' ? (await agent.catalog.get()).models.find(m => m.isDefault)?.id || null : job.model;
    const options = { directory: jobDir, prompt, instructions, mode: questionMode ? 'question' : 'explanation', responseSchema: questionMode ? questionSchema : refine ? refineSchema : explanationSchema, model: runtimeModel,
      sessionKey: job.chatId, workspaceId: w.id, sourceRoot: scope, searchScope, indexAccess, signal: job.controller.signal, onContext: addContext, onSession: job.retainSession ? onSession : undefined,
      // The same scoped tools are injectable for deterministic integration tests.
      sourceTools: toolsFor(),
      onProcess: child => { job.child = child; }, onEvent };
    const writing = questionMode ? '확장된 사고 · 조사 결과로 답변 작성' : '확장된 사고 · 조사 결과로 해설 초안 작성';
    if (job.extended) phase('answer', writing, 'running');
    const result = await (job.retainSession ? agent.sessions.run : agent.run)(options);
    for (const c of await readAudit(jobDir)) addContext(c);
    if (job.controller.signal.aborted) throw Error('요청이 취소되었습니다.');
    validateShape(result, questionMode, !!refine);
    if (job.extended) phase('answer', writing, 'complete');
    job.partial = JSON.stringify(result);
    job.warnings = [...extendedWarnings];
    const diagrams = refine ? [] : normalizeDiagrams(result.diagrams, context, job.warnings);
    // Explanations written for a chat request link back to that answer, like answer-explain ones to theirs.
    const base = { workspaceId: w.id, sourceConversationId: questionMode ? job.id : origin?.id, sourceChatId: questionMode ? job.chatId : origin?.chatId, generationId: job.id, createdAt: job.createdAt, sequenceAt: job.createdAt, agent: agent.id };
    const plan = refine && planRefinement({ result, context, refine, base, warnings: job.warnings });
    let sections = refine ? [] : normalizeSections({ result, context, target, questionMode, base, warnings: job.warnings });
    if (refine && result.sections.length && !plan.updates.length && !plan.added.length && !plan.removed.length) throw Error(`다듬은 해설의 코드 위치를 확인하지 못했습니다. ${job.warnings.join(' / ')}`);
    if (!questionMode && !refine && !sections.length) throw Error(`해설의 코드 위치를 확인하지 못했습니다. ${job.warnings.join('\n')}`);
    // Extended thinking: a reviewer supplements and polishes the verified draft (file or chat-requested) before it is saved.
    if (job.extended && !refine && sections.length) {
      phase('review', '확장된 사고 · 해설 초안을 검토해 보충하고 다듬는 중', 'running');
      try {
        const excerpts = excerptsFor(sections.map(({ path, start, end }) => ({ path, start, end })), context);
        const reviewed = await extraPass('review', '해설 검토', { prompt: buildReviewPrompt({ ...promptArgs, draft: draftForReview(sections), research, excerpts }), instructions: reviewInstructions({ workspace: w, target, roles }), responseSchema: refineSchema });
        if (signal.aborted) throw Error('요청이 취소되었습니다.');
        const merged = applyReview({ result: reviewed, draft: sections, context, target, base, warnings: job.warnings });
        if (merged) { sections = merged.sections; job.review = { summary: merged.summary, updated: merged.updated, added: merged.added, removed: merged.removed }; }
        phase('review', merged ? `확장된 사고 · 검토 반영: 수정 ${merged.updated} · 추가 ${merged.added} · 삭제 ${merged.removed}` : '확장된 사고 · 검토 결과를 반영하지 않고 초안 저장', 'complete');
      } catch (e) {
        if (signal.aborted) throw e;
        job.warnings.push(`해설 검토 단계를 완료하지 못해 초안을 저장했습니다: ${e.message}`);
        phase('review', '확장된 사고 · 검토 실패, 초안 저장', 'failed');
      }
    }
    // A chat answer keeps its diagrams on the conversation.
    if (sections.length && !questionMode) sections[0].diagrams = diagrams;
    job.suggestedFiles = normalizeSuggestedFiles(result, context);
    job.webSources = normalizeWebSources(result);
    if (!job.path) job.path = sections[0]?.path || job.suggestedFiles[0]?.path || '';
    const produced = refine ? [...plan.updates, ...plan.added].map(x => x.note) : sections;
    job.generatedNotes = produced.map(n => ({ id: n.id, path: n.path, start: n.start, title: n.title }));
    if (refine) job.refine = { summary: result.summary, updated: plan.updates.length, added: plan.added.length, removed: plan.removed.length, removedIds: [] };
    const conversation = { id: job.id, kind, chatId: job.chatId, agent: agent.id, sourceConversationId: origin?.id, workspaceId: w.id, sessionId: job.sessionId, retainSession: job.retainSession, tokenUsage: job.tokenUsage, path: job.path,
      model: job.model, requestedModel: job.requestedModel, modelNotice: job.modelNotice, question: question || (kind === 'overview' ? '파일 개요 생성' : refine ? '해설 다듬기' : '선택 코드 해설'), answer: result.summary, sections, diagrams,
      promptVersion: PROMPT_VERSION, ...(searchScope.length ? { searchScope } : {}), attachedContexts: raw.map(({ path, start, end }) => ({ path, start, end })), attachedFiles, context, activity: job.activity, suggestedFiles: job.suggestedFiles, webSources: job.webSources,
      ...(job.extended ? { extended: true, research: job.research, review: job.review || null } : {}), status: 'complete', createdAt: job.createdAt, promoted: kind !== 'question' };
    job.save = () => store.update(d => {
      if (d.conversations.some(c => c.id === job.id)) return;
      if (refine) job.refine.removedIds = applyRefinement(d, plan, { workspaceId: w.id, sequenceAt: job.createdAt, warnings: job.warnings }).removed;
      else if (sections.length) { attachRevisions(sections, d.notes, { workspaceId: w.id, noteId }); d.notes.push(...sections); }
      const chat = job.chatId && d.chats.find(c => c.id === job.chatId);
      if (chat) applyAnswerTitle(chat, result.title);
      d.conversations.push({ ...conversation, warnings: job.warnings });
    });
    try { await job.save(); job.status = 'complete'; job.stage = '저장됨'; }
    catch { job.status = 'save_failed'; job.error = '응답은 받았지만 저장하지 못했습니다. 다시 저장하세요.'; job.partial = JSON.stringify(result); }
  } catch (e) {
    for (const c of await readAudit(jobDir)) addContext(c);
    const status = job.controller.signal.aborted ? 'cancelled' : 'failed'; job.error = e.message;
    try {
      await store.update(d => {
        d.conversations.push({ id: job.id, kind, chatId: job.chatId, agent: agent.id, sourceConversationId: origin?.id, workspaceId: w.id, sessionId: job.sessionId, retainSession: job.retainSession, path: target?.path || '', model: job.model, requestedModel: job.requestedModel, modelNotice: job.modelNotice, question, answer: job.partial, attachedFiles, ...(job.extended ? { extended: true } : {}), context, activity: job.activity, sections: [], status, error: e.message, createdAt: job.createdAt });
        const chat = job.chatId && d.chats.find(c => c.id === job.chatId); if (chat) chat.updatedAt = new Date().toISOString();
      });
    } catch { job.error += ' · 요청 기록도 저장하지 못했습니다.'; }
    job.status = status;
  } finally {
    if (indexAccess) agentIndex.revoke(indexAccess.token);
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}
