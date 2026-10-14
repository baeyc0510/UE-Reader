import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/app.mjs';
import { Store } from '../server/store/store.mjs';
import { migrate } from '../server/store/migrations.mjs';
import { extractJson } from '../server/agents/json-output.mjs';
import { claudeArgs, claudeEventHandler, claudeResult } from '../server/agents/claude/index.mjs';
import { normalizeClaudeModels } from '../server/agents/claude/models.mjs';
import { sourceToolName } from '../server/agents/source-scope.mjs';
import { analysisInstructions, DEFAULT_ROLE, DEFAULT_RESEARCH_ROLE } from '../server/analysis/prompts.mjs';

const text = '// test\nvoid Tick() {\n    Move();\n}\nvoid Move() {\n    Step();\n}\n';
async function fixture(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ue-reader-chat-'));
  const root = path.join(base, 'source'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'Actor.cpp'), text);
  const service = await createApp({ codeIndex: false, dataDir: path.join(base, 'data'), statusProvider: async () => ({ available: true, authenticated: true }), modelProvider: async () => [{ id: 'test-model', displayName: 'Test', isDefault: true }], modelVersionProvider: async () => 'v1', ...options });
  const server = service.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (route, method = 'GET', body) => { const r = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json() }; };
  t.after(async () => { for (const j of service.jobs.values()) j.controller.abort(); service.agents.close(); await service.codeIndexes.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const { data: w } = await request('/workspaces', 'POST', { root });
  return { ...service, base, root, w, request };
}
async function waitJob(request, id) { for (let i = 0; i < 200; i++) { const { data } = await request(`/jobs/${id}`); if (data.status !== 'running') return data; await new Promise(r => setTimeout(r, 10)); } throw Error('Job timeout'); }
const answer = title => async () => ({ title, summary: '답변', suggestedFiles: [], webSources: [], diagrams: [] });

test('a first answer names its chat, the user can rename it, and later answers keep the user title', async t => {
  let title = 'GC 마킹 단계의 흐름';
  const f = await fixture(t, { runner: async () => answer(title)() });
  const first = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '가비지 컬렉션은 어떤 순서로 객체를 표시하나요? 자세히 알려 주세요' });
  assert.ok(first.data.chatId);
  let chats = (await f.request('/workspaces/general/chats')).data;
  assert.equal(chats.length, 1); assert.match(chats[0].title, /^가비지 컬렉션/); assert.equal(chats[0].titleSource, 'auto');
  await waitJob(f.request, first.data.id);
  chats = (await f.request('/workspaces/general/chats')).data;
  assert.equal(chats[0].title, 'GC 마킹 단계의 흐름'); assert.equal(chats[0].titleSource, 'generated');
  title = '다른 제목';
  const second = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '후속', chatId: first.data.chatId }); await waitJob(f.request, second.data.id);
  assert.equal((await f.request('/workspaces/general/chats')).data[0].title, 'GC 마킹 단계의 흐름');
  assert.equal((await f.request(`/chats/${first.data.chatId}`, 'PATCH', { title: '   ' })).status, 400);
  assert.equal((await f.request(`/chats/${first.data.chatId}`, 'PATCH', { title: '내가 붙인 이름' })).data.titleSource, 'user');
  const third = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '또 후속', chatId: first.data.chatId }); await waitJob(f.request, third.data.id);
  const reopened = await new Store(path.join(f.base, 'data')).init();
  assert.equal(reopened.data.chats[0].title, '내가 붙인 이름');
  assert.equal((await f.request(`/workspaces/general/conversations?chatId=${first.data.chatId}`)).data.length, 3);
});

test('chats keep separate histories; deleting hides a chat and its answers until restored', async t => {
  const f = await fixture(t, { runner: answer('주제') });
  const a = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: 'A 질문' }); await waitJob(f.request, a.data.id);
  const b = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: 'B 질문' }); await waitJob(f.request, b.data.id);
  assert.notEqual(a.data.chatId, b.data.chatId);
  assert.deepEqual((await f.request(`/workspaces/general/conversations?chatId=${a.data.chatId}`)).data.map(c => c.question), ['A 질문']);
  assert.equal((await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '없는 채팅', chatId: 'missing' })).status, 404);
  await f.request(`/chats/${a.data.chatId}`, 'PATCH', { deleted: true });
  assert.deepEqual((await f.request('/workspaces/general/chats')).data.map(c => c.id), [b.data.chatId]);
  assert.deepEqual((await f.request('/workspaces/general/conversations')).data.map(c => c.question), ['B 질문']);
  assert.equal((await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '삭제된 채팅', chatId: a.data.chatId })).status, 404);
  await f.request(`/chats/${a.data.chatId}`, 'PATCH', { deleted: false });
  assert.equal((await f.request('/workspaces/general/chats')).data.length, 2);
});

test('a visualization request stays in the chat of the answer it continues', async t => {
  const f = await fixture(t, { runner: answer('흐름') });
  const q = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '흐름 질문' }); await waitJob(f.request, q.data.id);
  const v = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '시각화', referenceConversationId: q.data.id });
  assert.equal(v.data.chatId, q.data.chatId);
});

test('legacy single-list questions migrate into one chat per workspace and linked notes learn the chat', () => {
  const data = migrate({ version: 1, workspaces: [], sessions: {}, settings: { model: 'old-model' }, modelCatalog: { models: [] }, agentSessions: { w1: {} },
    conversations: [{ id: 'q1', workspaceId: 'w1', question: '첫 질문', status: 'complete', createdAt: '2026-01-01' }, { id: 'q2', workspaceId: 'w1', kind: 'question', question: '둘째', createdAt: '2026-01-02' }, { id: 'e1', workspaceId: 'w1', kind: 'overview', question: '파일 개요 생성' }],
    notes: [{ id: 'n1', sourceConversationId: 'q1' }] });
  assert.equal(data.chats.length, 1); assert.match(data.chats[0].title, /첫 질문/);
  assert.equal(data.conversations[0].chatId, data.chats[0].id); assert.equal(data.conversations[2].chatId, undefined);
  assert.equal(data.notes[0].sourceChatId, data.chats[0].id);
  assert.deepEqual(data.settings.models, { codex: 'old-model' }); assert.equal(data.settings.model, undefined);
  assert.ok(data.modelCatalogs.codex); assert.deepEqual(data.agentSessions, {}); assert.equal(data.version, 2);
  assert.equal(migrate(structuredClone(data)).chats.length, 1);
});

test('explanation sections keep the agent teaching order; a new lesson reorders, a single regeneration keeps its place', async t => {
  let reversed = false, single = false;
  const f = await fixture(t, { runner: async args => {
    await args.sourceTools('read_file', { path: 'Actor.cpp', start: 1, end: 7 });
    const move = { path: 'Actor.cpp', title: 'Move', overview: '', body: '먼저 Move', start: 5, end: 7, details: [], evidence: [] }, tick = { path: 'Actor.cpp', title: 'Tick', overview: '', body: '그다음 Tick', start: 2, end: 4, details: [], evidence: [] };
    return { title: 't', summary: '흐름 소개', diagrams: [], sections: single ? [tick] : reversed ? [tick, move] : [move, tick] };
  } });
  const job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'overview', path: 'Actor.cpp' }); await waitJob(f.request, job.data.id);
  const notes = (await f.request(`/workspaces/${f.w.id}/file?path=Actor.cpp`)).data.notes;
  assert.deepEqual(notes.map(n => [n.title, n.order]), [['Move', 0], ['Tick', 1]]);
  assert.ok(notes.every(n => n.sequenceAt === notes[0].sequenceAt && n.agent === 'codex'));
  reversed = true;
  const lesson = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'overview', path: 'Actor.cpp' }); await waitJob(f.request, lesson.data.id);
  const reordered = f.store.data.notes.filter(n => n.selected).sort((a, b) => a.order - b.order);
  assert.deepEqual(reordered.map(n => [n.title, n.revision]), [['Tick', 2], ['Move', 2]]); assert.ok(reordered.every(n => n.sequenceAt === lesson.data.createdAt));
  single = true;
  const tick = reordered[0];
  const again = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'explain', path: 'Actor.cpp', noteId: tick.id, contexts: [{ path: 'Actor.cpp', start: 2, end: 4 }] }); await waitJob(f.request, again.data.id);
  const revised = f.store.data.notes.find(n => n.groupId === tick.groupId && n.selected);
  assert.equal(revised.revision, 3); assert.equal(revised.sequenceAt, tick.sequenceAt); assert.equal(revised.order, 0);
});

test('saved explanations are browsed by file first, then per file', async t => {
  const f = await fixture(t, { runner: async args => { await args.sourceTools('read_file', { path: 'Actor.cpp', start: 1, end: 7 }); return { title: 't', summary: 's', diagrams: [], sections: [{ path: 'Actor.cpp', title: 'Tick 해설', overview: '', body: 'b', start: 2, end: 4, details: [], evidence: [] }] }; } });
  const job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'overview', path: 'Actor.cpp' }); await waitJob(f.request, job.data.id);
  const files = (await f.request(`/workspaces/${f.w.id}/notes/files`)).data;
  assert.deepEqual(files.map(x => [x.path, x.count]), [['Actor.cpp', 1]]);
  assert.equal((await f.request(`/workspaces/${f.w.id}/notes/files?q=nothing`)).data.length, 0);
  assert.equal((await f.request(`/workspaces/${f.w.id}/notes?path=Actor.cpp`)).data[0].title, 'Tick 해설');
});

test('the selected agent and its own model reach the matching runner; each agent keeps its model', async t => {
  const used = [];
  const fake = id => ({ runner: async args => { used.push([id, args.model]); return { title: 'x', summary: `${id} 답변`, suggestedFiles: [], webSources: [], diagrams: [] }; } });
  const claudeModels = [{ id: 'opus', displayName: 'Opus 5.5', isDefault: true }, { id: 'claude-sonnet-5', displayName: 'Sonnet 5' }];
  const f = await fixture(t, { ...fake('codex'), agentOverrides: { claude: { ...fake('claude'), statusProvider: async () => ({ available: true, authenticated: true, message: 'claude' }), modelProvider: async () => claudeModels, modelVersionProvider: async () => '1' } } });
  assert.deepEqual((await f.request('/agents')).data.map(a => a.id), ['codex', 'claude']);
  assert.equal((await f.request('/settings/agent', 'PUT', { agent: 'unknown' })).status, 400);
  assert.equal((await f.request('/settings/agent', 'PUT', { agent: 'gemini' })).status, 400);
  await f.request('/settings/agent', 'PUT', { agent: 'claude' });
  assert.deepEqual((await f.request('/agents/claude/models')).data.models.map(m => m.id), ['opus', 'claude-sonnet-5']);
  assert.equal((await f.request('/settings/model', 'PUT', { model: 'claude-not-listed' })).status, 400);
  assert.equal((await f.request('/settings/model', 'PUT', { model: 'claude-sonnet-5' })).status, 200);
  assert.equal((await f.request('/settings/model', 'PUT', { agent: 'codex', model: 'test-model' })).status, 200);
  const usage = (await f.request('/agents/claude/usage')).data; assert.equal(usage.unsupported, true); assert.deepEqual(usage.buckets, []);
  const one = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: 'Claude 질문' });
  assert.equal(one.data.agent, 'claude'); await waitJob(f.request, one.data.id);
  await f.request('/settings/agent', 'PUT', { agent: 'codex' });
  const two = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: 'Codex 질문', chatId: one.data.chatId }); await waitJob(f.request, two.data.id);
  assert.deepEqual(used, [['claude', 'claude-sonnet-5'], ['codex', 'test-model']]);
  const boot = (await f.request('/bootstrap')).data;
  assert.equal(boot.settings.agent, 'codex'); assert.deepEqual(boot.settings.models, { claude: 'claude-sonnet-5', codex: 'test-model' }); assert.equal(boot.settings.model, 'test-model');
  assert.deepEqual((await f.request(`/workspaces/general/conversations?chatId=${one.data.chatId}`)).data.map(c => [c.agent, c.model]), [['claude', 'claude-sonnet-5'], ['codex', 'test-model']]);
});

test('switching agents inside a retained chat replays the chat history to the new agent once', async t => {
  const prompts = [];
  const session = id => async args => { prompts.push([id, args.prompt]); await args.onSession?.({ id: `${id}-session` }); return { title: 'x', summary: `${id} 답변`, suggestedFiles: [], webSources: [], diagrams: [] }; };
  const f = await fixture(t, { sessionRunner: session('codex'), agentOverrides: { claude: { sessionRunner: session('claude') } } });
  await f.request('/settings/conversation', 'PUT', { retainSession: true, historyCount: 6 });
  await f.request('/settings/agent', 'PUT', { agent: 'claude' });
  const first = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '첫 질문' }); await waitJob(f.request, first.data.id);
  await f.store.update(d => { d.agentSessions[first.data.chatId] = { id: 'claude-session', provider: 'claude' }; });
  const second = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '둘째', chatId: first.data.chatId }); await waitJob(f.request, second.data.id);
  assert.match(prompts[1][1], /Prior conversation: \[\]/);
  await f.request('/settings/agent', 'PUT', { agent: 'codex' });
  const third = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '셋째', chatId: first.data.chatId }); await waitJob(f.request, third.data.id);
  assert.equal(prompts[2][0], 'codex'); assert.match(prompts[2][1], /첫 질문/); assert.match(prompts[2][1], /둘째/);
});

test('Claude Code models come from the CLI initialize response; the CLI default marks its alias', () => {
  const models = normalizeClaudeModels([
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)' },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'Best for everyday, complex tasks' },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5' },
    { value: 'claude-opus-5', resolvedModel: 'claude-opus-5', displayName: 'Opus 5' },
    { displayName: 'broken' },
  ]);
  assert.deepEqual(models.map(m => [m.id, m.isDefault]), [['opus', true], ['sonnet', false], ['claude-opus-5', false]]);
  assert.equal(models[0].description, 'Best for everyday, complex tasks · claude-opus-5-5');
  assert.equal(models[2].description, '');
  assert.throws(() => normalizeClaudeModels(undefined), /형식/);
});

test('a removed agent setting falls back to the default agent without losing other models', () => {
  const data = migrate({ version: 2, settings: { agent: 'gemini', models: { gemini: 'pro', claude: 'opus' } }, modelCatalogs: { gemini: {}, codex: {} }, agentSessions: { a: { provider: 'gemini' }, b: { provider: 'claude' } }, chats: [], conversations: [], notes: [] });
  assert.equal(data.settings.agent, undefined); assert.deepEqual(data.settings.models, { claude: 'opus' });
  assert.deepEqual(Object.keys(data.modelCatalogs), ['codex']); assert.deepEqual(Object.keys(data.agentSessions), ['b']);
});

test('agent JSON extraction tolerates fences and prose', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Here it is: {"a":{"b":2}} done'), { a: { b: 2 } });
  assert.equal(extractJson('no json'), null);
  assert.equal(sourceToolName('mcp__ue_reader__read_file'), 'read_file'); assert.equal(sourceToolName('ue_reader__search_code'), 'search_code'); assert.equal(sourceToolName('run_shell_command'), null);
});

test('Claude Code runs with only web and read-only source tools, and stream events become progress and a result', () => {
  const args = claudeArgs({ schema: { type: 'object' }, mcpConfig: 'mcp.json', instructions: 'teach', model: 'opus', session: { id: 's1', resume: true } });
  assert.equal(args[args.indexOf('--tools') + 1], 'WebSearch,WebFetch');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.match(args[args.indexOf('--allowedTools') + 1], /mcp__ue_reader__read_file/);
  assert.ok(args.includes('--strict-mcp-config')); assert.deepEqual(args.slice(-2), ['--resume', 's1']);
  assert.ok(claudeArgs({ schema: {}, session: null }).includes('--no-session-persistence'));
  const events = [], state = {}, handle = claudeEventHandler(e => events.push(e), state);
  handle({ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: '파일을 찾겠습니다.' }, { type: 'tool_use', id: 't1', name: 'mcp__ue_reader__read_file', input: { path: 'A.cpp' } }] } });
  handle({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } });
  handle({ type: 'stream_event', event: { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', name: 'StructuredOutput' } } });
  handle({ type: 'stream_event', event: { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"summary":"부분' } } });
  handle({ type: 'result', is_error: false, structured_output: { summary: '완료' }, usage: { input_tokens: 3, output_tokens: 4 } });
  assert.equal(events[0].activity.tool, 'commentary'); assert.equal(events[1].activity.detail, 'A.cpp'); assert.equal(events[2].activity.status, 'complete');
  assert.equal(events.find(e => e.partial).partial, '{"summary":"부분');
  assert.deepEqual(claudeResult(state), { summary: '완료' });
  assert.throws(() => claudeResult({ result: { is_error: true, result: 'OAuth access token has expired' } }), /로그인/);
});

test('instructions teach in an explanation order and keep developer terms untranslated', () => {
  const text = analysisInstructions({ questionMode: false, workspace: { root: 'x', name: 'n', version: 'v' }, target: { path: 'A.cpp' }, kind: 'overview' });
  assert.match(text, /TEACHING ORDER/); assert.match(text, /Do NOT order by source line number/);
  assert.match(text, /GC \(not 쓰레기 수집/); assert.match(text, /리플렉션 \(not 반사\)/); assert.match(text, /instructor/);
  assert.match(text, /What first, then why/); assert.match(text, /Describe blocks, not lines/); assert.match(text, /No metaphors/); assert.match(text, /Avoid translationese/); assert.match(text, /ASD-STE100/); assert.match(text, /2 to 6 per section/);
  assert.match(text, /Keep in English: Outer, Incremental/); assert.match(text, /Introduce unfamiliar names before relying on them/); assert.match(text, /once per response/);
  assert.match(analysisInstructions({ questionMode: true, workspace: { root: null } }), /title: a short, natural Korean title/);
});

test('agent roles default to engine and project code, can be customized in settings and reach the instructions', async t => {
  let seen;
  const f = await fixture(t, { runner: async args => { seen = args; return answer('역할')(); } });
  assert.match(DEFAULT_ROLE, /game projects/); assert.match(DEFAULT_RESEARCH_ROLE, /project code/);
  let roles = (await f.request('/settings/roles')).data;
  assert.deepEqual([roles.role, roles.researchRole], ['', '']); assert.equal(roles.defaults.role, DEFAULT_ROLE);
  assert.equal((await f.request('/settings/roles', 'PUT', { role: 'x'.repeat(6001), researchRole: '' })).status, 400);
  roles = (await f.request('/settings/roles', 'PUT', { role: '  당신은 게임플레이 프로그래머입니다.  ', researchRole: DEFAULT_RESEARCH_ROLE })).data;
  assert.equal(roles.role, '당신은 게임플레이 프로그래머입니다.'); assert.equal(roles.researchRole, '', 'the default is stored as empty');
  const job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: '역할 확인' });
  await waitJob(f.request, job.data.id);
  assert.ok(seen.instructions.startsWith('당신은 게임플레이 프로그래머입니다.')); assert.ok(!seen.instructions.includes(DEFAULT_ROLE));
  assert.ok(analysisInstructions({ questionMode: true, workspace: { root: null } }).startsWith(DEFAULT_ROLE));
});

test('refining saved explanations revises, adds, removes and reorders within the allowed options', async t => {
  let mode = 'lesson', seen;
  const f = await fixture(t, { runner: async args => {
    seen = args;
    if (mode === 'lesson') {
      await args.sourceTools('read_file', { path: 'Actor.cpp', start: 1, end: 7 });
      return { title: 't', summary: '파일 소개', diagrams: [{ id: 'flow', title: '흐름', kind: 'call-chain', nodes: [{ id: 'tick', label: 'Tick', explanation: '시작', references: [{ path: 'Actor.cpp', start: 2, end: 4 }] }], edges: [] }], sections: [{ path: 'Actor.cpp', title: 'Tick', overview: '', body: 'Tick 초안', start: 2, end: 4, details: [], evidence: [] }, { path: 'Actor.cpp', title: 'Move', overview: '', body: 'Move 초안', start: 5, end: 7, details: [], evidence: [] }] };
    }
    const [tick, move] = JSON.parse(args.prompt.match(/Existing explanations to refine[^\n]*\n(.*)\n/)[1])[0].notes;
    return { summary: 'Tick을 보강하고 Move를 정리했습니다.', removed: [{ noteId: move.noteId, reason: '중복' }], order: [{ path: 'Actor.cpp', noteIds: ['new-1', tick.noteId] }],
      sections: [{ noteId: tick.noteId, path: 'Actor.cpp', title: 'Tick (보강)', overview: 'Tick 보강', body: '', start: 2, end: 4, details: [], evidence: [] },
        { noteId: 'new-1', path: 'Actor.cpp', title: '전체 흐름', overview: '', body: '흐름', start: 2, end: 7, details: [], evidence: [] }] };
  } });
  const lesson = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'overview', path: 'Actor.cpp' }); await waitJob(f.request, lesson.data.id);
  mode = 'refine';
  assert.equal((await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'refine', paths: [] })).status, 400);
  // Without add/delete permission only the revision is applied.
  let job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'refine', paths: ['Actor.cpp'], question: '더 친절하게' });
  let done = await waitJob(f.request, job.data.id);
  assert.equal(done.status, 'complete'); assert.match(seen.instructions, /Adding: NOT allowed/); assert.match(seen.prompt, /더 친절하게/);
  assert.deepEqual([done.refine.updated, done.refine.added, done.refine.removed], [1, 0, 0]);
  let current = f.store.data.notes.filter(n => n.selected && !n.deletedAt).sort((a, b) => a.order - b.order);
  assert.deepEqual(current.map(n => [n.title, n.revision]), [['Tick (보강)', 2], ['Move', 1]]);
  assert.equal(current[0].summary, '파일 소개'); assert.equal(current[0].body, 'Tick 보강');
  const original = f.store.data.notes.find(n => n.groupId === current[0].groupId && n.revision === 1);
  assert.equal(current[0].diagramRecordId, original.generationId); assert.deepEqual(current[0].diagrams, original.diagrams);
  // With both options the new note leads, the duplicate is removed.
  job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'refine', paths: ['Actor.cpp'], allowAdd: true, allowDelete: true });
  done = await waitJob(f.request, job.data.id);
  assert.match(seen.instructions, /Adding: allowed/); assert.deepEqual([done.refine.updated, done.refine.added, done.refine.removed], [1, 1, 1]);
  current = f.store.data.notes.filter(n => n.selected && !n.deletedAt).sort((a, b) => a.order - b.order);
  assert.deepEqual(current.map(n => [n.title, n.revision]), [['전체 흐름', 1], ['Tick (보강)', 3]]);
  assert.ok(current.every(n => n.sequenceAt === current[0].sequenceAt));
});

test('diagram links of a refined explanation resolve through the record that produced them', async t => {
  let refine = false;
  const f = await fixture(t, { runner: async args => {
    if (refine) { const [file] = JSON.parse(args.prompt.match(/Existing explanations to refine[^\n]*\n(.*)\n/)[1]); const n = file.notes[0];
      return { summary: '다듬음', removed: [], order: [], sections: [{ noteId: n.noteId, path: 'Actor.cpp', title: '', overview: '새 개요', body: '', start: 2, end: 4, details: [], evidence: [] }] }; }
    await args.sourceTools('read_file', { path: 'Actor.cpp', start: 1, end: 7 });
    return { title: 't', summary: 's', sections: [{ path: 'Actor.cpp', title: 'Tick', overview: '', body: 'b', start: 2, end: 4, details: [], evidence: [] }],
      diagrams: [{ id: 'flow', title: '흐름', kind: 'call-chain', nodes: [{ id: 'tick', label: 'Tick', explanation: '시작', references: [{ path: 'Actor.cpp', start: 2, end: 4 }] }], edges: [] }] };
  } });
  const job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'overview', path: 'Actor.cpp' }); await waitJob(f.request, job.data.id);
  refine = true;
  const again = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'refine', paths: ['Actor.cpp'] }); await waitJob(f.request, again.data.id);
  const note = f.store.data.notes.find(n => n.selected);
  assert.equal(note.title, 'Tick'); assert.equal(note.revision, 2);
  const link = { diagramId: note.diagrams[0].id, nodeId: 'tick', referenceIndex: 0 };
  assert.equal((await f.request(`/workspaces/${f.w.id}/diagram-reference`, 'POST', { recordId: note.diagramRecordId, ...link })).data.start, 2);
  // Notes refined before the fix still resolve through their note group.
  assert.equal((await f.request(`/workspaces/${f.w.id}/diagram-reference`, 'POST', { recordId: note.generationId, noteId: note.id, ...link })).data.start, 2);
});

const chatSection = (path, title, start, end) => ({ path, title, overview: `${title} 개요`, body: '', start, end, details: [{ title: '블록', text: `${title} 설명`, start, end }], evidence: [] });

test('asking in chat for code explanations lets the agent choose files and saves verified notes linked to the answer', async t => {
  let received;
  const f = await fixture(t, { runner: async options => {
    received = options;
    if (!options.prompt.includes('해설 만들어')) return { title: '일반 답변', summary: '답변', suggestedFiles: [], webSources: [], diagrams: [], sections: [] };
    await options.sourceTools('read_file', { path: 'Actor.cpp', start: 1, end: 7 });
    return { title: '이동 처리 해설', summary: '`Actor.cpp`를 골라 해설했습니다.', suggestedFiles: [], webSources: [], diagrams: [],
      sections: [chatSection('Actor.cpp', '`Tick`: 매 프레임 이동 호출', 2, 4), chatSection('Actor.cpp', '`Move`: 한 걸음 이동', 5, 7), chatSection('Other.cpp', '읽지 않은 파일', 1, 3)] };
  } });
  const plain = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: 'Tick은 무엇인가요?' });
  assert.equal((await waitJob(f.request, plain.data.id)).generatedNotes.length, 0);
  assert.deepEqual(received.responseSchema.required.includes('sections'), true);
  assert.match(received.instructions, /Fill it ONLY when the user explicitly asks you to write or generate code explanations/);
  const job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: '이동 처리 코드 해설 만들어 줘', chatId: plain.data.chatId });
  const done = await waitJob(f.request, job.data.id);
  assert.equal(done.status, 'complete'); assert.equal(done.kind, 'question');
  assert.deepEqual(done.generatedNotes.map(n => n.title), ['`Tick`: 매 프레임 이동 호출', '`Move`: 한 걸음 이동']);
  assert.ok(done.warnings.some(w => w.includes('Other.cpp')), 'a section on unread code is dropped');
  const notes = (await f.request(`/workspaces/${f.w.id}/file?path=Actor.cpp`)).data.notes.filter(n => n.generationId === job.data.id).sort((a, b) => a.order - b.order);
  assert.deepEqual(notes.map(n => [n.sourceConversationId, n.sourceChatId]), [[job.data.id, plain.data.chatId], [job.data.id, plain.data.chatId]]);
  const answer = (await f.request(`/workspaces/${f.w.id}/conversations?chatId=${plain.data.chatId}`)).data.find(c => c.id === job.data.id);
  assert.deepEqual(answer.explanations.map(e => e.path), ['Actor.cpp']);
  assert.equal(answer.answer, '`Actor.cpp`를 골라 해설했습니다.');
});
