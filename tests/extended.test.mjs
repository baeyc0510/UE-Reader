import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { RESEARCH_LIMITS } from '../server/analysis/extended.mjs';
import { createSourceTools } from '../server/agents/source-tools.mjs';

const text = '// test\nvoid Tick() {\n    Move();\n}\nvoid Move() {\n    Step();\n}\n';
async function fixture(t, runner) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ue-reader-extended-'));
  const root = path.join(base, 'source'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'Actor.cpp'), text);
  const calls = [];
  const service = await createApp({ codeIndex: false, dataDir: path.join(base, 'data'), statusProvider: async () => ({ available: true, authenticated: true }), modelProvider: async () => [{ id: 'test-model', displayName: 'Test', isDefault: true }], modelVersionProvider: async () => 'v1',
    runner: async options => { calls.push(options); return runner(options, calls.length); } });
  const server = service.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (route, method = 'GET', body) => { const r = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json() }; };
  t.after(async () => { for (const j of service.jobs.values()) j.controller.abort(); service.agents.close(); await service.codeIndexes.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const { data: w } = await request('/workspaces', 'POST', { root });
  return { ...service, base, root, w, request, calls };
}
async function waitJob(request, id) { for (let i = 0; i < 300; i++) { const { data } = await request(`/jobs/${id}`); if (data.status !== 'running') return data; await new Promise(r => setTimeout(r, 10)); } throw Error('Job timeout'); }
const research = { summary: '`Tick`이 매 프레임 `Move`를 부르는 구조입니다.', findings: [{ topic: 'Tick → Move', detail: '`Tick`은 `Move`를 호출합니다.', references: [{ path: 'Actor.cpp', start: 2, end: 4 }, { path: 'Actor.cpp', start: 40, end: 50 }] }], openQuestions: ['`Step`의 정의는 찾지 못했습니다.'] };
const section = (title, start, end, extra = {}) => ({ path: 'Actor.cpp', title, overview: `${title} 개요`, body: '', start, end, details: [{ title: '블록', text: `${title} 설명`, start, end }], evidence: [], ...extra });

test('source tool budgets follow the given limits (the research pass gets larger ones)', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ue-reader-limits-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.writeFile(path.join(base, 'Actor.cpp'), text);
  const small = createSourceTools(base, { limits: { calls: 2, chars: 1000 } });
  await small('read_file', { path: 'Actor.cpp', start: 1, end: 2 }); await small('read_file', { path: 'Actor.cpp', start: 3, end: 4 });
  await assert.rejects(small('read_file', { path: 'Actor.cpp', start: 5, end: 6 }), /호출 한도 2회/);
  const wide = createSourceTools(base, { limits: RESEARCH_LIMITS });
  for (let i = 0; i < 100; i++) await wide('read_file', { path: 'Actor.cpp', start: 1, end: 1 });
});

test('extended thinking is a saved setting; off means a single agent run', async t => {
  const f = await fixture(t, async () => ({ title: '주제', summary: '답변', suggestedFiles: [], webSources: [], diagrams: [] }));
  assert.equal((await f.request('/bootstrap')).data.settings.extendedThinking, false);
  assert.equal((await f.request('/settings/extended-thinking', 'PUT', { enabled: 'yes' })).status, 400);
  const job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: '질문' }); await waitJob(f.request, job.data.id);
  assert.deepEqual(f.calls.map(c => c.mode), ['question']);
  assert.equal((await f.request('/settings/extended-thinking', 'PUT', { enabled: true })).data.extendedThinking, true);
  assert.equal((await f.request('/bootstrap')).data.settings.extendedThinking, true);
});

test('a question with extended thinking runs a research agent first and answers from its verified notes', async t => {
  const f = await fixture(t, async options => {
    if (options.mode === 'research') { await options.sourceTools('read_file', { path: 'Actor.cpp', start: 1, end: 7 }); return research; }
    return { title: '주제', summary: '답변', suggestedFiles: [{ path: 'Actor.cpp', start: 2, end: 4, reason: '탐색이 읽은 범위' }], webSources: [], diagrams: [] };
  });
  await f.request('/settings/extended-thinking', 'PUT', { enabled: true });
  const job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: 'Tick은 무엇을 하나요?' });
  const done = await waitJob(f.request, job.data.id);
  assert.equal(done.status, 'complete');
  const [researchCall, answerCall] = f.calls;
  assert.deepEqual(f.calls.map(c => c.mode), ['research', 'question']);
  assert.deepEqual(researchCall.sourceLimits, RESEARCH_LIMITS);
  assert.ok(researchCall.responseSchema.required.includes('findings'));
  assert.match(researchCall.instructions, /research agent of extended thinking/);
  assert.match(answerCall.prompt, /Research notes from the extended-thinking research agent[\s\S]*Tick → Move[\s\S]*Actor\.cpp L2–4\n2: void Tick\(\) \{/);
  const [c] = (await f.request(`/workspaces/${f.w.id}/conversations?chatId=${job.data.chatId}`)).data;
  assert.equal(c.extended, true);
  assert.deepEqual(c.research.findings[0].references, [{ path: 'Actor.cpp', start: 2, end: 4 }], 'unread references are dropped');
  assert.deepEqual(c.suggestedFiles.map(s => s.path), ['Actor.cpp'], 'the answer may cite code the research agent read');
  assert.ok(c.activity.some(a => a.tool === 'phase' && a.id === 'research:phase' && a.status === 'complete'));
});

test('extended explanations are reviewed: revisions, additions, removals and order apply; unverified changes keep the draft', async t => {
  const f = await fixture(t, async options => {
    if (options.mode === 'research') return research;
    if (options.mode === 'review') return { summary: '`Move` 설명을 보충했습니다.', removed: [{ noteId: 'draft-2', reason: '중복' }],
      order: [{ path: 'Actor.cpp', noteIds: ['new-1', 'draft-1', 'draft-3'] }],
      sections: [{ noteId: 'draft-1', ...section('`Tick`: 매 프레임 이동 호출', 2, 4) }, { noteId: 'new-1', ...section('`Move`: 한 걸음 이동', 5, 7) }, { noteId: 'draft-3', ...section('범위 밖', 40, 50) }] };
    return { title: '해설', summary: '파일 요약', diagrams: [], sections: [section('Tick', 2, 4), section('Tick 중복', 2, 3), section('주석', 1, 1)] };
  });
  await f.request('/settings/extended-thinking', 'PUT', { enabled: true });
  const job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'explain', path: 'Actor.cpp', contexts: [{ path: 'Actor.cpp', start: 1, end: 7 }] });
  const done = await waitJob(f.request, job.data.id);
  assert.equal(done.status, 'complete');
  assert.deepEqual(f.calls.map(c => c.mode), ['research', 'explanation', 'review']);
  assert.match(f.calls[2].prompt, /"noteId":"draft-1"[\s\S]*Research notes/);
  assert.match(f.calls[2].instructions, /reviewing editor/);
  assert.deepEqual(done.review, { summary: '`Move` 설명을 보충했습니다.', updated: 1, added: 1, removed: 1 });
  assert.ok(done.warnings.some(w => w.startsWith('검토 단계')), 'an out-of-range revision is reported and the draft kept');
  const notes = (await f.request(`/workspaces/${f.w.id}/file?path=Actor.cpp`)).data.notes.sort((a, b) => a.order - b.order);
  assert.deepEqual(notes.map(n => n.title), ['`Move`: 한 걸음 이동', '`Tick`: 매 프레임 이동 호출', '주석']);
  assert.ok(notes.every(n => n.summary === '파일 요약'));
});

test('a failed research or review pass falls back to the normal result with a warning', async t => {
  let round = 0;
  const f = await fixture(t, async options => {
    if (options.mode === 'research') { round++; if (round === 1) throw Error('탐색 실패'); return research; }
    if (options.mode === 'review') throw Error('검토 실패');
    return { title: '해설', summary: '요약', diagrams: [], sections: [section('Tick', 2, 4)] };
  });
  await f.request('/settings/extended-thinking', 'PUT', { enabled: true });
  const first = await waitJob(f.request, (await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'explain', path: 'Actor.cpp', contexts: [{ path: 'Actor.cpp', start: 1, end: 7 }] })).data.id);
  assert.equal(first.status, 'complete');
  assert.ok(first.warnings.some(w => /탐색 단계를 완료하지 못해/.test(w)));
  assert.ok(first.warnings.some(w => /검토 단계를 완료하지 못해/.test(w)));
  assert.doesNotMatch(f.calls[1].prompt, /Research notes/);
  assert.equal(first.generatedNotes[0].title, 'Tick');
});

test('explanations requested in chat also get the extended-thinking review', async t => {
  const f = await fixture(t, async options => {
    if (options.mode === 'research') return research;
    if (options.mode === 'review') return { summary: '보충했습니다.', removed: [], order: [{ path: 'Actor.cpp', noteIds: ['draft-1'] }], sections: [{ noteId: 'draft-1', ...section('`Tick`: 검토한 제목', 2, 4) }] };
    await options.sourceTools('read_file', { path: 'Actor.cpp', start: 1, end: 7 });
    return { title: '해설', summary: '골랐습니다.', suggestedFiles: [], webSources: [], diagrams: [], sections: [section('Tick', 2, 4)] };
  });
  await f.request('/settings/extended-thinking', 'PUT', { enabled: true });
  const done = await waitJob(f.request, (await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: 'Tick 코드 해설 만들어 줘' })).data.id);
  assert.deepEqual(f.calls.map(c => c.mode), ['research', 'question', 'review']);
  assert.match(f.calls[2].instructions, /the code chosen for the user's request/);
  assert.deepEqual(done.generatedNotes.map(n => n.title), ['`Tick`: 검토한 제목']);
  assert.equal(done.review.updated, 1);
});
