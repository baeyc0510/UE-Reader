import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { Store } from '../server/store/store.mjs';
import { readSource, locateNote, hash } from '../server/source/source.mjs';
import { createApp } from '../server/app.mjs';
import { createSourceTools } from '../server/agents/source-tools.mjs';
import { createModelCatalog, normalizeModels } from '../server/agents/model-catalog.mjs';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { normalizeRateLimits, createUsageReader } from '../server/agents/codex/rpc.mjs';
import { inspectedRanges } from '../server/source/inspected-ranges.mjs';
import { normalizeDiagrams } from '../server/analysis/diagrams.mjs';

test('verified excerpts join adjacent and overlapping reads but reject gaps, conflicting text and mixed source versions', () => {
  const c = (start, end, text, hash = 'same') => ({ path: 'Folder/Actor.cpp', start, end, text, hash });
  const joined = inspectedRanges([c(1, 2, 'a\nb'), c(2, 3, 'b\nc'), c(4, 4, 'd')]);
  assert.equal(joined.find({ path: './Folder\\Actor.cpp', start: 1, end: 4 }).text, 'a\nb\nc\nd');
  assert.equal(joined.find({ path: '../Folder/Actor.cpp', start: 1, end: 4 }), undefined);
  assert.equal(inspectedRanges([c(1, 2, 'a\nb'), c(4, 4, 'd')]).find({ path: 'Folder/Actor.cpp', start: 1, end: 4 }), undefined);
  assert.equal(inspectedRanges([c(1, 2, 'a\nb'), c(3, 4, 'c\nd', 'new')]).find({ path: 'Folder/Actor.cpp', start: 1, end: 4 }), undefined);
  assert.equal(inspectedRanges([c(1, 2, 'a\nb'), c(2, 3, 'different\nc')]).find({ path: 'Folder/Actor.cpp', start: 1, end: 3 }), undefined);
});

test('valid function explanations survive an invalid section and keep exact sentence anchors across source moves', async t => {
  const f = await fixture(t, async () => ({ ...output, sections: [
    { ...output.sections[0], overview: 'Tick은 이동 처리를 위임하는 함수입니다.', details: [{ title: '이동 처리 위임', text: '호출을 실행합니다.', start: 3, end: 3 }], evidence: [{ path: './Actor.cpp', start: 2, end: 4 }] },
    { ...output.sections[0], start: 999, end: 1000 },
  ] }));
  const started = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'explain', path: 'Actor.cpp', contexts: [{ path: 'Actor.cpp', start: 1, end: 2 }, { path: 'Actor.cpp', start: 3, end: 4 }] });
  const job = await waitJob(f.request, started.data.id);
  assert.equal(job.status, 'complete', job.error); assert.equal(job.warnings.length, 1); assert.match(job.warnings[0], /Actor.cpp L999–1000/); assert.match(job.warnings[0], /L1–4/);
  const n = f.store.data.notes[0]; assert.equal(f.store.data.notes.length, 1); assert.equal(n.overview, 'Tick은 이동 처리를 위임하는 함수입니다.'); assert.equal(n.details[0].title, '이동 처리 위임'); assert.equal(n.body, 'Tick은 이동 처리를 위임하는 함수입니다.\n\n호출을 실행합니다.'); assert.equal(n.snapshot, f.text.split('\n').slice(1, 4).join('\n'));
  const moved = locateNote(n, { hash: 'changed', text: '// inserted\n' + f.text });
  assert.equal(moved.sourceState, 'moved'); assert.equal(moved.details[0].start, 4);
});

test('editing explanation blocks persists text, preserves anchors and rejects stale or invalid edits', async t => {
  const f = await fixture(t, async () => ({ ...output, sections: [{ ...output.sections[0], overview: '기존 개요', details: [{ title: '기존 제목', text: '기존 세부 설명', start: 3, end: 3 }] }] }));
  const job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'explain', path: 'Actor.cpp' });
  assert.equal((await waitJob(f.request, job.data.id)).status, 'complete');
  const note = structuredClone(f.store.data.notes[0]), endpoint = `/notes/${note.id}/content`;
  const edit = { part: 'detail', index: 0, text: '**수정한 설명**\n\nMove를 호출합니다.', title: '수정한 제목', expectedText: '기존 세부 설명', expectedTitle: '기존 제목' };
  for (const invalid of [{ ...edit, text: '' }, { ...edit, text: 'a'.repeat(30001) }, { ...edit, title: null }]) assert.equal((await f.request(endpoint, 'PATCH', invalid)).status, 400);
  assert.equal((await f.request(endpoint, 'PATCH', { ...edit, index: -1 })).status, 404);
  assert.equal((await f.request(endpoint, 'PATCH', { ...edit, start: 999, end: 999 })).status, 200);
  assert.equal((await f.request(endpoint, 'PATCH', edit)).status, 409);
  assert.equal((await f.request(endpoint, 'PATCH', { part: 'overview', text: '수정한 개요', expectedText: '기존 개요' })).status, 200);
  const saved = (await new Store(path.join(f.base, 'data')).init()).data.notes[0];
  assert.equal(saved.body, '수정한 개요\n\n' + edit.text); assert.equal(saved.details[0].title, edit.title);
  assert.equal(saved.details[0].start, 3); assert.equal(saved.details[0].end, 3);
  for (const key of ['start', 'end', 'hash', 'snapshot', 'revision']) assert.equal(saved[key], note[key]);
  assert.equal(await fs.readFile(path.join(f.root, 'Actor.cpp'), 'utf8'), f.text);
  assert.equal((await f.request(`/workspaces/${f.w.id}/notes?q=${encodeURIComponent('수정한 설명')}`)).data.length, 1);
});

test('legacy explanation bodies can be edited without creating or changing source links', async t => {
  const f = await fixture(t, async () => output);
  const job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'explain', path: 'Actor.cpp' });
  await waitJob(f.request, job.data.id);
  const note = structuredClone(f.store.data.notes[0]);
  assert.equal((await f.request(`/notes/${note.id}/content`, 'PATCH', { part: 'body', expectedText: note.body, text: '직접 편집한 본문' })).status, 200);
  assert.equal(f.store.data.notes[0].body, '직접 편집한 본문');
  assert.equal(f.store.data.notes[0].snapshot, note.snapshot);
});

test('custom instructions persist and reach questions and explanations without modifying their request structure', async t => {
  const received = [];
  const f = await fixture(t, async options => { received.push(options); return output; });
  assert.equal((await f.request('/settings/instructions')).data.instructionPrompt, '');
  for (const invalid of [null, 5, 'x'.repeat(12001)]) assert.equal((await f.request('/settings/instructions', 'PUT', { instructionPrompt: invalid })).status, 400);
  await f.request('/settings/instructions', 'PUT', { instructionPrompt: '결론부터 짧게 설명하세요.' });
  for (const kind of ['question', 'explain']) {
    const started = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind, path: 'Actor.cpp', question: '동작 설명' });
    assert.equal((await waitJob(f.request, started.data.id)).status, 'complete');
  }
  assert.ok(received.every(r => r.prompt.includes('결론부터 짧게 설명하세요.')));
  assert.equal((await new Store(path.join(f.base, 'data')).init()).data.settings.instructionPrompt, '결론부터 짧게 설명하세요.');
});

test('complete file index includes late neighbors and invalidates revisions on reindex', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, 'Many'));
  for (let batch = 0; batch < 12; batch++) await Promise.all(Array.from({ length: 100 }, (_, i) => fs.writeFile(path.join(f.root, 'Many', `Unit${String(batch * 100 + i).padStart(4, '0')}.cpp`), '// source')));
  await f.request(`/workspaces/${f.w.id}/index`, 'POST', {});
  await f.indexes.get(f.w.id).done;
  const endpoint = `/workspaces/${f.w.id}/files?all=1`;
  const first = (await f.request(endpoint)).data;
  assert.equal(first.files.length, 1201); assert.equal(first.status, 'ready');
  assert.ok(first.files.includes('Many/Unit1199.cpp'));
  const cached = (await f.request(endpoint + '&revision=' + encodeURIComponent(first.revision))).data;
  assert.equal(cached.files, undefined); assert.equal(cached.total, 1201);
  await fs.rename(path.join(f.root, 'Many/Unit1199.cpp'), path.join(f.root, 'Many/Replaced.cpp'));
  await f.request(`/workspaces/${f.w.id}/index`, 'POST', {});
  await f.indexes.get(f.w.id).done;
  const second = (await f.request(endpoint + '&revision=' + encodeURIComponent(first.revision))).data;
  assert.notEqual(second.revision, first.revision); assert.ok(second.files.includes('Many/Replaced.cpp'));
});

test('font settings validate input, persist globally and preserve other preferences', async t => {
  const f = await fixture(t);
  await f.request('/settings/instructions', 'PUT', { instructionPrompt: '상세하게 설명' });
  const appearance = { uiFont: 'Arial', codeFont: 'Courier New', textSize: 16, uiSize: 18 };
  assert.equal((await f.request('/settings/appearance', 'PUT', { ...appearance, uiSize: 99 })).status, 400);
  assert.equal((await f.request('/settings/appearance', 'PUT', { ...appearance, textSize: 99 })).status, 400);
  assert.equal((await f.request('/settings/appearance', 'PUT', { ...appearance, codeFont: '' })).status, 400);
  assert.equal((await f.request('/settings/appearance', 'PUT', appearance)).status, 200);
  assert.deepEqual((await f.request('/bootstrap')).data.settings.appearance, appearance);
  const reopened = await new Store(path.join(f.base, 'data')).init();
  assert.deepEqual(reopened.data.settings.appearance, appearance);
  assert.equal(reopened.data.settings.instructionPrompt, '상세하게 설명');
});

test('instruction edits and reset apply on the next turn of the same retained session', async t => {
  const mock = rpcFixture(); const f = await fixture(t, undefined, { sessionConnect: mock.connect });
  await f.request('/settings/conversation', 'PUT', { retainSession: true, historyCount: 6 });
  const ids = []; let chatId;
  for (const instructionPrompt of ['짧고 간결하게', '구체적인 예시 포함', '']) {
    await f.request('/settings/instructions', 'PUT', { instructionPrompt });
    const started = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '설명해 줘', chatId });
    chatId = started.data.chatId;
    ids.push((await waitJob(f.request, started.data.id)).sessionId);
  }
  assert.equal(new Set(ids).size, 1); assert.equal(mock.clients.length, 1);
  const turns = mock.calls.filter(c => c.method === 'turn/start').map(c => c.params.input[0].text);
  assert.match(turns[0], /짧고 간결하게/); assert.match(turns[1], /구체적인 예시 포함/); assert.doesNotMatch(turns[1], /짧고 간결하게/); assert.match(turns[2], /No custom preferences/);
});

async function fixture(t, runner, modelOptions = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ue-reader-test-'));
  const root = path.join(base, 'source'); await fs.mkdir(root);
  const text = '// test\nvoid Tick() {\n    Move();\n}\n';
  await fs.writeFile(path.join(root, 'Actor.cpp'), text);
  await fs.writeFile(path.join(base, 'outside.cpp'), 'private');
  const service = await createApp({ codeIndex: false, dataDir: path.join(base, 'data'), runner, statusProvider: async () => ({ available: true, authenticated: false }), modelProvider: async () => [{ id: 'test-model', displayName: 'Test model', isDefault: true }], modelVersionProvider: async () => 'test-cli-1', ...modelOptions });
  const server = service.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  async function request(route, method = 'GET', body) {
    const r = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() };
  }
  t.after(async () => { for (const j of service.jobs.values()) j.controller.abort(); service.agents.close(); await service.codeIndexes.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const { data: w } = await request('/workspaces', 'POST', { root });
  return { ...service, root, base, w, request, text, url };
}
const output = { title: 'Tick', summary: 'Tick에서 Move를 호출합니다.', sections: [{ title: '호출', body: '`Move()`를 호출합니다. 구현은 제공되지 않았습니다.', start: 2, end: 4, evidence: [{ path: 'Actor.cpp', start: 2, end: 4 }] }] };

test('an open file never becomes question context; explicit ranges are the only attached source', async t => {
  const received = [];
  const f = await fixture(t, async options => { received.push(options); return { summary: '엔진 전체 관점의 답변', suggestedFiles: [], webSources: [] }; });
  for (const path of ['Actor.cpp', 'NoLongerExists.cpp']) {
    const r = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', path, contexts: [], question: '엔진의 전체 라이프사이클은?' });
    assert.equal((await waitJob(f.request, r.data.id)).status, 'complete');
  }
  assert.ok(received.every(r => !r.prompt.includes('void Tick()')));
  assert.ok(f.store.data.conversations.every(c => c.context.length === 0 && c.attachedContexts.length === 0));
  const r = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', path: 'NoLongerExists.cpp', contexts: [{ path: 'Actor.cpp', start: 3, end: 3 }], question: '이 호출의 전체 흐름은?' });
  assert.equal((await waitJob(f.request, r.data.id)).status, 'complete');
  assert.match(received.at(-1).prompt, /3:     Move\(\);/);
  assert.doesNotMatch(received.at(-1).prompt, /2: void Tick/);
  assert.equal(f.store.data.conversations.at(-1).attachedContexts.length, 1);
});

test('ordinary explanations can inspect additional source and are not restricted to supplied excerpts', async t => {
  const f = await fixture(t, async options => {
    assert.equal(options.mode, 'explanation');
    assert.doesNotMatch(options.prompt, /Analyze only supplied excerpts|do not use tools|1–3 paragraphs/);
    const read = await options.sourceTools('read_file', { path: 'Actor.cpp', start: 2, end: 4 });
    assert.ok(read);
    return output;
  });
  const r = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'explain', path: 'Actor.cpp', contexts: [{ path: 'Actor.cpp', start: 3, end: 3 }] });
  assert.equal((await waitJob(f.request, r.data.id)).status, 'complete');
  assert.equal(f.store.data.notes[0].start, 2);
});

test('diagrams preserve conceptual nodes but drop uninspected links and invalid edges', () => {
  const warnings = [];
  const diagrams = normalizeDiagrams([{ title: '흐름', nodes: [
    { id: 'a', label: '진입', explanation: '설명', references: [{ path: '../outside.cpp', start: 1, end: 2 }] },
    { id: 'b', label: '종료', explanation: '개념', references: [] },
    { id: 'a', label: '중복', explanation: '', references: [] },
  ], edges: [{ from: 'a', to: 'b', kind: 'conditional', label: '준비 완료' }, { from: 'a', to: 'missing' }] }], [], warnings);
  assert.equal(diagrams[0].nodes.length, 2); assert.equal(diagrams[0].nodes[0].references.length, 0);
  assert.equal(diagrams[0].edges.length, 1); assert.equal(warnings.length, 1);
});

test('diagram explanations persist and code links revalidate moved and changed source', async t => {
  const diagram = { id: 'flow', title: 'Tick 흐름', kind: 'call-chain', nodes: [{ id: 'tick', label: 'Tick', explanation: 'Move 호출에 위임합니다.', references: [{ path: 'Actor.cpp', start: 2, end: 4 }] }], edges: [] };
  const f = await fixture(t, async options => { await options.sourceTools('read_file', { path: 'Actor.cpp', start: 2, end: 4 }); return { ...output, diagrams: [diagram] }; });
  const r = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: '흐름을 보여줘' });
  assert.equal((await waitJob(f.request, r.data.id)).status, 'complete');
  const restored = (await new Store(path.join(f.base, 'data')).init()).data.conversations[0];
  assert.equal(restored.diagrams[0].nodes[0].explanation, 'Move 호출에 위임합니다.');
  const payload = { recordId: r.data.id, diagramId: 'diagram-1', nodeId: 'tick', referenceIndex: 0 };
  const route = `/workspaces/${f.w.id}/diagram-reference`;
  assert.equal((await f.request(route, 'POST', payload)).data.start, 2);
  await fs.writeFile(path.join(f.root, 'Actor.cpp'), '// new\n' + f.text);
  const moved = await f.request(route, 'POST', payload);
  assert.equal(moved.data.sourceState, 'moved'); assert.equal(moved.data.start, 3);
  await fs.writeFile(path.join(f.root, 'Actor.cpp'), f.text.replace('Move()', 'Stop()'));
  assert.equal((await f.request(route, 'POST', payload)).status, 409);
  assert.equal((await f.request(route, 'POST', { ...payload, recordId: 'other-workspace' })).status, 404);
  const explain = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'explain', path: 'Actor.cpp' });
  assert.equal((await waitJob(f.request, explain.data.id)).status, 'complete');
  assert.equal(f.store.data.notes[0].diagrams.length, 1);
});

test('legacy detailed answers remain available for follow-up analysis and visualization', async t => {
  let received;
  const f = await fixture(t, async options => { received = options; return { summary: '전체 흐름 설명' }; });
  await f.store.update(d => d.conversations.push({ id: 'old', workspaceId: f.w.id, question: '흐름 설명', answer: '짧은 요약', status: 'complete', context: [], sections: [{ title: '원래 상세', body: '기존 답변의 핵심 연결 정보' }] }));
  const r = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', referenceConversationId: 'old', question: '시각화해줘', contexts: [] });
  assert.equal((await waitJob(f.request, r.data.id)).status, 'complete');
  assert.match(received.prompt, /기존 답변의 핵심 연결 정보/);
  assert.equal(f.store.data.conversations.at(-1).context.length, 0);
});
test('shutdown rejects foreign or stale requests and active or unsaved work, then closes after saved state', async t => {
  let stopped = 0;
  const f = await fixture(t, undefined, { onShutdown: () => { stopped++; } });
  const control = (await f.request('/lifecycle')).data;
  assert.equal(control.canShutdown, true);
  assert.equal((await f.request('/shutdown', 'POST', { token: 'wrong' })).status, 403);
  assert.equal((await fetch(f.url + '/shutdown', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: control.token }) })).status, 403);
  f.jobs.set('pending', { status: 'running', controller: new AbortController() });
  assert.equal((await f.request('/shutdown', 'POST', { token: control.token })).status, 409);
  f.jobs.get('pending').status = 'save_failed';
  assert.equal((await f.request('/shutdown', 'POST', { token: control.token })).status, 409);
  f.jobs.clear();
  assert.equal(stopped, 0);
  await f.request(`/workspaces/${f.w.id}/session`, 'PUT', { questionDraft: '종료 직전 초안' });
  assert.equal((await f.request('/shutdown', 'POST', { token: control.token })).status, 200);
  assert.equal(stopped, 1);
  assert.equal((await f.request(`/workspaces/${f.w.id}/session`, 'PUT', {})).status, 503);
  const reopened = await new Store(path.join(f.base, 'data')).init();
  assert.equal(reopened.data.sessions[f.w.id].questionDraft, '종료 직전 초안');
});

test('the actual server exits cleanly through the shutdown endpoint', { timeout: 15000 }, async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ue-reader-shutdown-'));
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: path.resolve('.'), env: { ...process.env, PORT: '0', UE_READER_DATA: base }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) child.kill(); await fs.rm(base, { recursive: true, force: true }); });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  const url = await new Promise((resolve, reject) => {
    let stdout = '';
    child.stdout.on('data', data => { stdout += data; const match = stdout.match(/UE Reader: (http:\/\/127\.0\.0\.1:\d+)/); if (match) resolve(match[1]); });
    child.once('error', reject); child.once('exit', () => reject(Error('Server exited before ready')));
  });
  const control = await fetch(url + '/api/lifecycle').then(r => r.json());
  assert.equal(control.pid, child.pid);
  const response = await fetch(url + '/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: control.token }) });
  assert.equal(response.status, 200);
  await response.json();
  assert.equal(await exited, 0);
  await assert.rejects(fetch(url + '/api/health'));
});
async function waitJob(request, id) { for (let i = 0; i < 100; i++) { const { data } = await request(`/jobs/${id}`); if (data.status !== 'running') return data; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Job timeout'); }

test('source paths reject traversal, absolute paths, non-source files, and escaping symlinks', async t => {
  const f = await fixture(t);
  assert.equal((await readSource(f.root, 'Actor.cpp')).text, f.text);
  await assert.rejects(readSource(f.root, '../outside.cpp'), /허용되지/);
  await assert.rejects(readSource(f.root, path.join(f.base, 'outside.cpp')), /상대 소스/);
  await assert.rejects(readSource(f.root, 'secrets.json'), /허용되지/);
  const outer = path.join(f.base, 'other'); await fs.mkdir(outer); await fs.writeFile(path.join(outer, 'secret.cpp'), 'secret');
  await fs.symlink(outer, path.join(f.root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readSource(f.root, 'link/secret.cpp'), /작업공간 밖/);
});
test('notes relocate only unique exact code, and disable changed or ambiguous anchors', () => {
  const snapshot = 'void Tick() {\n    Move();\n}';
  const note = { start: 1, end: 3, snapshot, hash: hash(snapshot) };
  assert.equal(locateNote(note, { text: snapshot, hash: hash(snapshot) }).sourceState, 'same');
  const moved = locateNote(note, { text: '// new\n' + snapshot, hash: 'new' });
  assert.equal(moved.sourceState, 'moved'); assert.equal(moved.start, 2); assert.equal(moved.end, 4);
  assert.equal(locateNote(note, { text: snapshot.replace('Move', 'Stop'), hash: 'new' }).sourceState, 'changed');
  assert.equal(locateNote(note, { text: snapshot + '\n' + snapshot, hash: 'new' }).sourceState, 'changed');
});
test('atomic store serializes changes and survives restart', async t => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 20 }, (_, i) => f.store.update(d => { d.sessions[`tab${i}`] = i; })));
  const reopened = await new Store(path.join(f.base, 'data')).init();
  assert.equal(Object.keys(reopened.data.sessions).length, 20);
  assert.equal(reopened.data.workspaces[0].root, f.root);
});
test('local API blocks foreign origin and host, validates file paths and context ranges', async t => {
  const f = await fixture(t);
  await f.store.update(d => { d.sessions.general = { drafts: { '': '파일 없이 작성한 질문' } }; });
  assert.deepEqual((await f.request('/health')).data, { service: 'ue-reader', version: 1 });
  assert.equal((await fetch(f.url + '/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(f.url + '/bootstrap', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => { const request = http.get(f.url + '/bootstrap', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); });
  assert.equal(badHostStatus, 403);
  assert.equal((await f.request(`/workspaces/${f.w.id}/file?path=..%2Foutside.cpp`)).status, 403);
  assert.equal((await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { path: 'Actor.cpp', contexts: [{ path: 'Actor.cpp', start: 0, end: 999 }] })).status, 400);
});
test('generation persists evidence, versions, renamed notes, deletion and undo without changing source', async t => {
  const f = await fixture(t, async () => output);
  const generated = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { path: 'Actor.cpp', kind: 'explain' });
  assert.equal(generated.status, 202); assert.equal((await waitJob(f.request, generated.data.id)).status, 'complete');
  let notes = (await f.request(`/workspaces/${f.w.id}/notes`)).data;
  assert.equal(notes.length, 1); const id = notes[0].id;
  const second = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { path: 'Actor.cpp', noteId: id, kind: 'explain' });
  await waitJob(f.request, second.data.id);
  notes = (await f.request(`/workspaces/${f.w.id}/notes`)).data;
  assert.equal(notes.length, 2); assert.equal(notes.filter(n => n.selected).length, 1); assert.equal(notes.find(n => n.selected).revision, 2);
  await f.request(`/notes/${id}`, 'PATCH', { selected: true, title: '액터 호출 흐름' });
  assert.equal((await f.request(`/workspaces/${f.w.id}/notes?q=${encodeURIComponent('액터')}`)).data.length, 1);
  await f.request(`/notes/${id}`, 'PATCH', { deleted: true });
  assert.equal((await f.request(`/workspaces/${f.w.id}/notes`)).data.length, 1);
  await f.request(`/notes/${id}`, 'PATCH', { deleted: false });
  assert.equal((await f.request(`/workspaces/${f.w.id}/notes`)).data.length, 2);
  assert.equal(await fs.readFile(path.join(f.root, 'Actor.cpp'), 'utf8'), f.text);
  const reopened = await new Store(path.join(f.base, 'data')).init(); assert.equal(reopened.data.conversations.length, 2);
});
test('cancelled and failed requests keep partial responses separate from complete notes', async t => {
  const f = await fixture(t, async ({ signal, onEvent }) => { onEvent({ partial: '부분 설명' }); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('취소')), { once: true })); });
  const result = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { path: 'Actor.cpp', question: '왜 호출하나요?' });
  await f.request(`/jobs/${result.data.id}/cancel`, 'POST');
  assert.equal((await waitJob(f.request, result.data.id)).status, 'cancelled');
  assert.equal(f.store.data.notes.length, 0); assert.equal(f.store.data.conversations[0].answer, '부분 설명');
});
test('questions never create notes; an explicit answer-based request generates fresh code sections', async t => {
  const calls = [];
  const f = await fixture(t, async args => {
    calls.push(args);
    if (args.mode === 'explanation') await args.sourceTools('read_file', { path: 'Actor.cpp', start: 2, end: 4 });
    return { ...output, summary: args.mode === 'explanation' ? '새 코드 해설 개요' : '질문에 집중한 답변', sections: output.sections.map(s => ({ ...s, path: 'Actor.cpp', body: '별도 요청에서 현재 소스를 읽고 작성한 구체적인 해설입니다.' })) };
  });
  const first = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { path: 'Actor.cpp', kind: 'question', question: '이 함수의 역할은?' });
  const question = await waitJob(f.request, first.data.id); assert.equal(question.status, 'complete');
  assert.equal(f.store.data.notes.length, 0); assert.deepEqual(f.store.data.conversations[0].sections, []);
  assert.equal((await f.request(`/conversations/${first.data.id}/promote`, 'POST')).status, 410);
  const second = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'answer-explain', conversationId: first.data.id, path: 'Actor.cpp' });
  const explanation = await waitJob(f.request, second.data.id); assert.equal(explanation.status, 'complete', explanation.error);
  assert.equal(calls.length, 2); assert.equal(calls[1].mode, 'explanation'); assert.match(calls[1].prompt, /질문에 집중한 답변/);
  assert.equal(f.store.data.notes.length, 1); assert.equal(f.store.data.notes[0].sourceConversationId, first.data.id); assert.equal(f.store.data.notes[0].generationId, second.data.id);
  assert.notEqual(f.store.data.notes[0].body, f.store.data.conversations[0].answer);
  const history = (await f.request(`/workspaces/${f.w.id}/conversations`)).data;
  assert.equal(history.length, 1); assert.equal(history[0].explanations[0].path, 'Actor.cpp');
  assert.equal((await f.request('/workspaces/general/generate', 'POST', { kind: 'answer-explain', conversationId: first.data.id })).status, 400);
});
test('missing source retains notes and relocation retains workspace identity', async t => {
  const f = await fixture(t, async () => output);
  const result = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { path: 'Actor.cpp' }); await waitJob(f.request, result.data.id);
  const newRoot = path.join(f.base, 'moved-source'); await fs.rename(f.root, newRoot);
  const missing = (await f.request(`/workspaces/${f.w.id}/file?path=Actor.cpp`)).data;
  assert.equal(missing.source, null); assert.equal(missing.notes[0].sourceState, 'missing');
  const relocated = await f.request('/workspaces', 'POST', { root: newRoot, relocateId: f.w.id }); assert.equal(relocated.data.id, f.w.id);
  const reopened = (await f.request(`/workspaces/${f.w.id}/file?path=Actor.cpp`)).data;
  assert.equal(reopened.notes[0].sourceState, 'same');
});

test('a question without an open file lets the agent choose and read source, with durable evidence', async t => {
  let options;
  const f = await fixture(t, async args => {
    options = args;
    const found = await args.sourceTools('search_files', { query: 'Actor.cpp' });
    assert.deepEqual(found.files, ['Actor.cpp']);
    const matches = await args.sourceTools('search_code', { query: 'Move' });
    assert.equal(matches.results[0].line, 3);
    await args.sourceTools('read_file', { path: found.files[0], start: 2, end: 4 });
    // An ordinary question (not a request for explanations) returns no sections.
    return { ...output, sections: [], suggestedFiles: [{ path: 'Actor.cpp', start: 2, end: 4, reason: '이 함수에서 Move를 호출합니다.' }, { path: 'Invented.cpp', start: 1, end: 5, reason: '확인되지 않은 경로' }], webSources: [{ title: '공식 문서', url: 'https://dev.epicgames.com/documentation/en-us/unreal-engine/actor-ticking-in-unreal-engine' }, { title: '허용하지 않는 URL', url: 'javascript:alert(1)' }] };
  });
  const started = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: '이동 처리는 어느 파일부터 보면 되나요?', contexts: [] });
  assert.equal(started.status, 202);
  const result = await waitJob(f.request, started.data.id);
  assert.equal(result.status, 'complete'); assert.equal(options.mode, 'question'); assert.deepEqual(options.sourceRoot, { root: f.root, folders: [] });
  assert.equal(result.requestPath, ''); assert.equal(result.path, 'Actor.cpp'); assert.equal(result.suggestedFiles.length, 1);
  assert.equal(result.webSources.length, 1); assert.equal(result.context[0].automatic, true);
  const saved = new Store(path.join(f.base, 'data')); await saved.init();
  assert.equal(saved.data.conversations[0].context[0].text, 'void Tick() {\n    Move();\n}');
  assert.equal(saved.data.notes.length, 0);
  assert.equal(await fs.readFile(path.join(f.root, 'Actor.cpp'), 'utf8'), f.text);
});

test('general knowledge and web answers need neither a workspace nor local code sections', async t => {
  const f = await fixture(t, async args => {
    assert.equal(args.mode, 'question'); assert.equal(args.sourceRoot, null);
    await assert.rejects(args.sourceTools('search_files', { query: 'Actor' }), /작업공간이 지정되지/);
    return { title: '개념 설명', summary: '일반 지식과 공식 문서를 바탕으로 설명합니다.', sections: [], suggestedFiles: [], webSources: [] };
  });
  const started = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: 'UObject와 AActor의 차이는 무엇인가요?' });
  assert.equal(started.status, 202); assert.equal((await waitJob(f.request, started.data.id)).status, 'complete');
  const conversations = (await f.request('/workspaces/general/conversations')).data;
  assert.equal(conversations[0].path, ''); assert.deepEqual(conversations[0].sections, []);
  assert.equal((await f.request(`/conversations/${started.data.id}/promote`, 'POST')).status, 410);
  await f.request('/workspaces/general/session', 'PUT', { drafts: { '': '후속 질문' }, tabs: [], active: '' });
  assert.equal(f.store.data.sessions.general.drafts[''], '후속 질문');
});

test('agent source tools enforce scope, valid ranges, and records of inspected excerpts', async t => {
  const f = await fixture(t); const reads = [];
  const call = createSourceTools(f.root, { onRead: c => reads.push(c) });
  await assert.rejects(call('read_file', { path: '../outside.cpp' }), /허용되지/);
  await assert.rejects(call('read_file', { path: 'Actor.cpp', start: 0, end: 2 }), /1~400줄/);
  await assert.rejects(call('write_file', { path: 'Actor.cpp', text: 'bad' }), /지원하지 않는/);
  const file = await call('read_file', { path: 'Actor.cpp', start: 2, end: 4 });
  assert.equal(file.start, 2); assert.match(file.content, /3:     Move/);
  await call('read_file', { path: 'Actor.cpp', start: 2, end: 4 });
  assert.equal(reads.length, 1);
});

test('answer-based explanations reject uninspected anchors even when an old answer mentions the file', async t => {
  const f = await fixture(t, async () => ({ ...output, sections: output.sections.map(s => ({ ...s, path: 'Actor.cpp' })) }));
  const first = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: '함수를 찾아 주세요.' });
  await waitJob(f.request, first.data.id);
  const started = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'answer-explain', conversationId: first.data.id });
  const result = await waitJob(f.request, started.data.id);
  assert.equal(result.status, 'failed'); assert.match(result.error, /확인한 범위/); assert.equal(f.store.data.notes.length, 0);
});

test('models are discovered dynamically, refresh after CLI updates, and chosen model reaches the runner', async t => {
  let version = 'cli-1', modelList = [{ id: 'model-a', displayName: 'Model A', isDefault: true }, { id: 'model-b', displayName: 'Model B' }], calls = 0;
  const used = [];
  const f = await fixture(t, async args => { used.push(args.model); return { summary: '모델 시험 답변', sections: [], suggestedFiles: [], webSources: [] }; }, { modelProvider: async () => { calls++; return modelList; }, modelVersionProvider: async () => version });
  assert.equal((await f.request('/agents/codex/models')).data.models.length, 2);
  await f.request('/agents/codex/models'); assert.equal(calls, 1);
  assert.equal((await f.request('/settings/model', 'PUT', { model: 'not-in-catalog' })).status, 400);
  assert.equal((await f.request('/settings/model', 'PUT', { model: 'model-b' })).status, 200);
  const first = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '모델 설정 시험' });
  const firstResult = await waitJob(f.request, first.data.id); assert.equal(firstResult.model, 'model-b'); assert.equal(used[0], 'model-b');
  const stored = await new Store(path.join(f.base, 'data')).init(); assert.equal(stored.data.settings.models.codex, 'model-b'); assert.equal(stored.data.conversations[0].model, 'model-b');
  version = 'cli-2'; modelList = [{ id: 'model-new', displayName: 'New model', isDefault: true }];
  const fresh = (await f.request('/agents/codex/models')).data; assert.equal(fresh.cliVersion, 'cli-2'); assert.equal(fresh.models[0].id, 'model-new'); assert.equal(calls, 2);
  const second = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '업데이트 이후 시험' });
  const secondResult = await waitJob(f.request, second.data.id);
  assert.equal(secondResult.model, null); assert.equal(secondResult.requestedModel, 'model-b'); assert.match(secondResult.modelNotice, /현재 목록에 없어/); assert.equal(used[1], null);
  assert.equal(f.store.data.settings.models.codex, 'model-b');
  await f.request('/agents/codex/models?refresh=1'); assert.equal(calls, 3);
  await f.request('/settings/model', 'PUT', { model: null }); assert.equal(f.store.data.settings.models.codex, null);
});

test('catalog failures preserve the last good list and do not block the default model', async t => {
  let unavailable = false;
  const f = await fixture(t, async () => ({ summary: '기본 모델 답변', sections: [] }), { modelProvider: async () => [{ id: 'cached-model', displayName: 'Cached model' }], modelVersionProvider: async () => { if (unavailable) throw Error('offline'); return 'cli-1'; } });
  await f.request('/agents/codex/models'); unavailable = true;
  const stale = (await f.request('/agents/codex/models?refresh=1')).data;
  assert.equal(stale.stale, true); assert.equal(stale.models[0].id, 'cached-model'); assert.match(stale.warning, /마지막 목록/);
  const reloaded = await new Store(path.join(f.base, 'data')).init();
  const catalog = createModelCatalog({ store: reloaded, provider: async () => { throw Error('unavailable'); }, versionProvider: async () => { throw Error('offline'); } });
  assert.equal((await catalog.get()).models[0].id, 'cached-model');
  assert.equal((await catalog.resolveModel('cached-model')).model, 'cached-model');
  const started = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '기본 모델은 계속 사용할 수 있나요?' });
  assert.equal((await waitJob(f.request, started.data.id)).status, 'complete');
});

test('model parser keeps future identifiers and tolerates extra fields without listing hidden or unsafe entries', () => {
  const result = normalizeModels([
    { model: 'future-family-v7', displayName: 'Future', unknownField: true },
    { slug: 'future-next', display_name: 'Next', visibility: 'list' },
    { id: 'future-next', displayName: 'Duplicate' },
    { id: 'hidden-model', hidden: true },
    { id: 'image-only', inputModalities: ['image'] },
    { id: '--bad-flag' }
  ]);
  assert.deepEqual(result.map(m => m.id), ['future-family-v7', 'future-next']);
});

test('conversation settings persist, limit same-chat completed pairs, and allow zero history', async t => {
  let received;
  const f = await fixture(t, async options => { received = options; return { summary: '답변', sections: [] }; });
  const initial = (await f.request('/bootstrap')).data.settings;
  assert.equal(initial.retainSession, false); assert.equal(initial.historyCount, 6);
  for (const invalid of [-1, 51, 1.5, '6', null]) assert.equal((await f.request('/settings/conversation', 'PUT', { retainSession: false, historyCount: invalid })).status, 400);
  await f.store.update(d => {
    for (const id of ['chat-a', 'chat-b']) d.chats.push({ id, workspaceId: 'general', title: id, titleSource: 'user', createdAt: '2026-01-01', updatedAt: '2026-01-01' });
    for (let i = 0; i < 7; i++) d.conversations.push({ id: String(i), chatId: 'chat-a', workspaceId: 'general', question: `Q${i}`, answer: `A${i}`, context: [], status: 'complete' });
    d.conversations.push({ chatId: 'chat-a', workspaceId: 'general', question: 'failed', status: 'failed', context: [] }, { chatId: 'chat-b', workspaceId: 'general', question: 'other chat', answer: 'x', status: 'complete', context: [] });
  });
  await f.request('/settings/conversation', 'PUT', { retainSession: false, historyCount: 2 });
  const first = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '다음 질문', chatId: 'chat-a' }); await waitJob(f.request, first.data.id);
  const history = JSON.parse(received.prompt.match(/Prior conversation: (.*)\n/)[1]);
  assert.deepEqual(history.map(c => c.question), ['Q5', 'Q6']);
  const fresh = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '새 채팅 질문' }); await waitJob(f.request, fresh.data.id);
  assert.match(received.prompt, /Prior conversation: \[\]/); assert.ok(fresh.data.chatId); assert.notEqual(fresh.data.chatId, 'chat-a');
  await f.request('/settings/conversation', 'PUT', { retainSession: false, historyCount: 0 });
  const second = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '독립 질문', chatId: 'chat-a' }); await waitJob(f.request, second.data.id);
  assert.match(received.prompt, /Prior conversation: \[\]/);
  assert.equal((await new Store(path.join(f.base, 'data')).init()).data.settings.historyCount, 0);
});

function rpcFixture({ delayed = false } = {}) {
  const calls = [], clients = []; let counter = 0;
  const connect = async () => {
    const events = new EventEmitter();
    const rpc = { events, closed: false, close() { this.closed = true; events.emit('disconnected', Error('closed')); }, async request(method, params) {
      calls.push({ method, params });
      if (method === 'thread/start') return { thread: { id: `thread-${++counter}` }, model: 'test-model' };
      if (method === 'thread/resume') return { thread: { id: params.threadId }, model: 'test-model' };
      if (method === 'turn/start') {
        const id = `turn-${++counter}`;
        if (!delayed) setImmediate(() => {
          const p = { threadId: params.threadId, turnId: id };
          events.emit('notification', 'item/started', { ...p, item: { id: 'message', type: 'agentMessage', phase: 'commentary', text: '' } });
          events.emit('notification', 'item/agentMessage/delta', { ...p, itemId: 'message', delta: '파일을 확인합니다.' });
          events.emit('notification', 'item/completed', { ...p, item: { id: 'message', type: 'agentMessage', phase: 'commentary', text: '파일을 확인합니다.' } });
          events.emit('notification', 'item/completed', { ...p, item: { id: 'final', type: 'agentMessage', phase: 'final_answer', text: JSON.stringify({ summary: '세션 답변', sections: [], suggestedFiles: [], webSources: [] }) } });
          events.emit('notification', 'turn/completed', { threadId: params.threadId, turn: { id, status: 'completed' } });
        });
        return { turn: { id } };
      }
    } };
    clients.push(rpc); return rpc;
  };
  return { connect, calls, clients };
}

test('persistent sessions reuse a process and thread, resume after restart, and reset without deleting answers', async t => {
  const mock = rpcFixture();
  const f = await fixture(t, async () => { throw Error('stateless runner must not run'); }, { sessionConnect: mock.connect });
  await f.request('/settings/conversation', 'PUT', { retainSession: true, historyCount: 6 });
  let chatId;
  async function ask() { const r = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '후속 질문', chatId }); chatId = r.data.chatId; const j = await waitJob(f.request, r.data.id); assert.equal(j.status, 'complete', j.error); return j; }
  const one = await ask(), two = await ask();
  assert.equal(one.sessionId, two.sessionId); assert.equal(mock.clients.length, 1); assert.equal(mock.calls.filter(c => c.method === 'thread/start').length, 1);
  assert.equal(two.activity.length, 1); assert.equal(two.activity[0].detail, '파일을 확인합니다.');
  for (const call of mock.calls.filter(c => c.method === 'turn/start')) assert.match(call.params.input[0].text, /Prior conversation: \[\]/);
  f.agents.close(); await ask();
  assert.equal(mock.calls.filter(c => c.method === 'thread/resume').length, 1);
  assert.equal((await f.request(`/chats/${chatId}/agent-session/reset`, 'POST')).status, 200);
  assert.equal(f.store.data.conversations.length, 3);
  const fresh = await ask(); assert.notEqual(fresh.sessionId, one.sessionId);
  assert.equal(mock.calls.filter(c => c.method === 'thread/start').length, 2);
  const w = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: '다른 작업공간' }); const other = await waitJob(f.request, w.data.id);
  assert.notEqual(other.sessionId, fresh.sessionId); assert.equal(mock.calls.filter(c => c.method === 'thread/start').length, 3);
  await f.request('/settings/conversation', 'PUT', { retainSession: false, historyCount: 1 });
  assert.deepEqual(f.store.data.agentSessions, {}); assert.ok(mock.clients.every(c => c.closed));
});

test('session reset and mode changes reject active requests, cancellation closes only its worker', async t => {
  const mock = rpcFixture({ delayed: true });
  const f = await fixture(t, undefined, { sessionConnect: mock.connect });
  await f.request('/settings/conversation', 'PUT', { retainSession: true, historyCount: 6 });
  const r = await f.request('/workspaces/general/generate', 'POST', { kind: 'question', question: '중지 시험' });
  while (!mock.calls.some(c => c.method === 'turn/start')) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.request(`/chats/${r.data.chatId}/agent-session/reset`, 'POST')).status, 409);
  assert.equal((await f.request('/settings/conversation', 'PUT', { retainSession: false, historyCount: 6 })).status, 409);
  await f.request(`/jobs/${r.data.id}/cancel`, 'POST');
  assert.equal((await waitJob(f.request, r.data.id)).status, 'cancelled'); assert.equal(mock.clients[0].closed, true);
});

test('persistent session revalidates old source before accepting suggested file ranges', async t => {
  let round = 0;
  const f = await fixture(t, undefined, { sessionRunner: async args => {
    await args.onSession({ id: 'same-session' });
    if (++round === 1) await args.sourceTools('read_file', { path: 'Actor.cpp', start: 2, end: 4 });
    return { ...output, suggestedFiles: [{ path: 'Actor.cpp', start: 2, end: 4, reason: '함수 구현' }] };
  } });
  await f.request('/settings/conversation', 'PUT', { retainSession: true, historyCount: 6 });
  const ask = async () => { const r = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: '이전 코드 후속 질문' }); return waitJob(f.request, r.data.id); };
  assert.equal((await ask()).suggestedFiles.length, 1); assert.equal((await ask()).suggestedFiles.length, 1);
  await fs.writeFile(path.join(f.root, 'Actor.cpp'), f.text.replace('Move', 'Stop'));
  const changed = await ask(); assert.equal(changed.status, 'complete'); assert.deepEqual(changed.suggestedFiles, []);
});

test('usage parsing uses all buckets, clamps remaining values, and never reports missing usage as zero', async () => {
  const buckets = normalizeRateLimits({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: { a: { limitId: 'a', primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 123 }, secondary: null }, b: { limitId: 'b', primary: { usedPercent: 110 }, secondary: { usedPercent: null } } } });
  assert.deepEqual(buckets.map(b => b.windows.map(w => w.remainingPercent)), [[80], [0]]);
  assert.deepEqual(normalizeRateLimits({ rateLimits: { primary: null } }), []);
  let calls = 0, fail = false;
  const read = createUsageReader({ provider: async () => { calls++; if (fail) throw Error('offline'); return { rateLimits: { primary: { usedPercent: 40 } } }; } });
  assert.equal((await read()).buckets[0].windows[0].remainingPercent, 60); await read(); assert.equal(calls, 1);
  fail = true; const stale = await read(true); assert.equal(stale.stale, true); assert.equal(stale.buckets[0].windows[0].remainingPercent, 60);
});

test('simultaneous generation requests start exactly one job', async t => {
  let executions = 0;
  const f = await fixture(t, async ({ signal }) => { executions++; await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('취소')), { once: true })); });
  const send = () => f.request(`/workspaces/${f.w.id}/generate`, 'POST', { path: 'Actor.cpp', kind: 'question', question: '중복 클릭' });
  const responses = await Promise.all([send(), send()]);
  assert.deepEqual(responses.map(r => r.status).sort(), [202, 409]);
  const accepted = responses.find(r => r.status === 202);
  while (!executions) await new Promise(resolve => setTimeout(resolve, 5));
  await f.request(`/jobs/${accepted.data.id}/cancel`, 'POST'); await waitJob(f.request, accepted.data.id);
  assert.equal(executions, 1);
});

test('an answer can explicitly request explanations across verified files without an open target', async t => {
  let explanation = false;
  const f = await fixture(t, async args => {
    if (!explanation) return { summary: '코드의 동작에 관한 답변', suggestedFiles: [], webSources: [] };
    await args.sourceTools('read_file', { path: 'Actor.cpp', start: 2, end: 4 });
    await args.sourceTools('read_file', { path: 'Other.h', start: 1, end: 2 });
    return { summary: '구현과 선언을 연결해 설명합니다.', sections: [
      { ...output.sections[0], path: 'Actor.cpp' },
      { title: '초기 상태', body: '선언된 기본 상태의 의미를 설명합니다.', path: 'Other.h', start: 1, end: 2, evidence: [] }
    ] };
  });
  await fs.writeFile(path.join(f.root, 'Other.h'), 'bool bReady = false;\nfloat Speed = 45;\n');
  const q = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: '선언과 동작의 관계는?' }); await waitJob(f.request, q.data.id);
  explanation = true;
  const e = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'answer-explain', conversationId: q.data.id });
  const job = await waitJob(f.request, e.data.id); assert.equal(job.status, 'complete', job.error);
  assert.equal(job.generatedNotes.length, 2); assert.equal(f.store.data.notes.filter(n => n.sourceConversationId === q.data.id).length, 2);
  const history = (await f.request(`/workspaces/${f.w.id}/conversations`)).data; assert.equal(history.length, 1); assert.equal(history[0].explanations.length, 2);
});
