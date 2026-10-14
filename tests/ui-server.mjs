import { createApp, projectRoot } from '../server/app.mjs';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ue-reader-ui-'));
const runner = async ({ sourceRoot, sourceTools, onEvent, signal, onSession, workspaceId, prompt, mode }) => {
  if (onSession) await onSession({ id: `test-session-${workspaceId}` });
  // Extended thinking: research notes from a real read, and a review that revises the first draft section.
  if (mode === 'research') {
    const { files } = sourceRoot ? await sourceTools('search_files', { query: 'ReadingActor.cpp' }) : { files: [] };
    if (files[0]) await sourceTools('read_file', { path: files[0], start: 28, end: 42 });
    return { summary: '탐색 시험: Tick에서 회전량을 계산합니다.', findings: files[0] ? [{ topic: '회전 계산', detail: 'Tick은 준비 상태를 확인한 뒤 회전량을 계산합니다.', references: [{ path: files[0], start: 28, end: 42 }] }] : [], openQuestions: [] };
  }
  if (mode === 'review') {
    const draft = JSON.parse(prompt.match(/Draft to review \(teaching order\): (.*)\n/)[1]), first = draft[0];
    return { summary: '검토 시험: 첫 해설의 개요를 보충했습니다.', removed: [], order: [{ path: first.path, noteIds: draft.map(d => d.noteId) }],
      sections: [{ noteId: first.noteId, path: first.path, title: `${first.title} (검토)`, overview: '검토 단계에서 보충한 개요입니다.', body: '', start: first.start, end: first.end, details: [], evidence: [] }] };
  }
  onEvent({ stage: '필요한 소스 찾는 중', activity: { id: 'progress', type: 'message', tool: 'commentary', detail: '질문과 관련된 구현을 확인하겠습니다.', status: 'complete' } });
  onEvent({ activity: { id: 'search', type: 'source', tool: 'search_files', detail: 'ReadingActor.cpp', status: 'running' } });
  onEvent({ partial: '{"summary":"관련 구현을 확인하고 있습니다.' });
  await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 2100); signal.addEventListener('abort', () => { clearTimeout(timer); reject(Error('요청이 취소되었습니다.')); }, { once: true }); });
  onEvent({ activity: { id: 'search', type: 'source', tool: 'search_files', detail: 'ReadingActor.cpp', status: 'complete' } });
  // Refinement: revise the first saved note of the first file, keep the rest (ranges come attached).
  const refine = prompt.match(/Existing explanations to refine[^\n]*\n(.*)\n/);
  if (refine) {
    const [file] = JSON.parse(refine[1]), first = file.notes[0];
    return { summary: '첫 해설을 더 쉽게 다듬었습니다.', removed: [], order: [{ path: file.path, noteIds: file.notes.map(n => n.noteId) }],
      sections: [{ noteId: first.noteId, path: file.path, title: `${first.title} (다듬음)`, overview: '', body: '다듬은 해설 본문입니다.', start: first.start, end: first.end, details: [], evidence: [] }] };
  }
  if (!sourceRoot) return { title: '일반 질문 시험', summary: '파일 없이 일반 지식으로 답하는 시험 응답입니다.', sections: [], suggestedFiles: [], webSources: [] };
  const { files } = await sourceTools('search_files', { query: 'ReadingActor.cpp' });
  await sourceTools('read_file', { path: files[0], start: 7, end: 42 });
  if (prompt.includes('시각화')) return { title: '회전 흐름', summary: '준비 상태를 확인한 뒤 회전량을 계산하고 적용합니다.', suggestedFiles: [], webSources: [], diagrams: [{ id: 'rotation', title: '회전 단계 흐름', kind: 'lifecycle', nodes: [
    { id: 'ready', label: '준비 상태', explanation: '준비된 액터에만 회전을 적용합니다.', references: [{ path: files[0], start: 28, end: 36 }] },
    { id: 'rotate', label: '회전량 계산', explanation: '프레임 시간과 속도로 이번 프레임의 회전량을 정합니다.', references: [{ path: files[0], start: 38, end: 41 }] },
    { id: 'idle', label: '대기 상태', explanation: '준비되지 않으면 다음 프레임을 기다립니다.', references: [] },
  ], edges: [{ from: 'ready', to: 'rotate', kind: 'conditional', label: '준비 완료' }, { from: 'ready', to: 'idle', kind: 'conditional', label: '준비 전' }, { from: 'idle', to: 'ready', kind: 'transition', label: '다음 프레임' }] }] };
  // A chat question returns sections only when it asks for explanations (the agent "chooses" ReadingActor.cpp).
  const chatExplain = mode === 'question' && /Question: [^\n]*해설 만들어/.test(prompt);
  return { title: '회전 구현', summary: chatExplain ? '`ReadingActor.cpp`를 골라 회전 처리 해설을 만들었습니다.' : '선택한 파일의 Tick에서 회전량을 계산합니다.', sections: mode === 'question' && !chatExplain ? [] : [{ path: files[0], title: chatExplain ? '회전 처리 (채팅 요청)' : '회전 처리', overview: 'Tick은 프레임 시간에 비례한 회전량을 계산해 액터에 적용합니다. 준비 상태를 먼저 검사하여 초기화되지 않은 상태에서는 회전하지 않습니다.', body: 'DeltaSeconds와 RotationSpeed를 곱합니다.', details: [{ title: '프레임 시간에 따른 회전량 계산', text: 'DeltaSeconds와 RotationSpeed를 곱합니다.', start: 38, end: 39 }, { text: '계산한 회전량을 적용합니다.', start: 40, end: 41 }], start: 28, end: 42, evidence: [{ path: files[0], start: 28, end: 42 }] }], suggestedFiles: [{ path: files[0], start: 28, end: 42, reason: '프레임별 회전을 계산하는 구현입니다.' }], webSources: [{ title: 'Epic 공식 Tick 문서 · 시험 출처', url: 'https://dev.epicgames.com/documentation/en-us/unreal-engine/actor-ticking-in-unreal-engine' }] };
};
const { app } = await createApp({ dataDir, runner, sessionRunner: runner, usageProvider: async () => ({ rateLimitsByLimitId: { codex: { limitId: 'codex', primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 1900000000 }, secondary: { usedPercent: 45, windowDurationMins: 10080, resetsAt: 1900001000 } } } }), statusProvider: async () => ({ available: true, authenticated: false, message: '테스트에서는 Codex를 호출하지 않습니다.' }), modelProvider: async () => [{ id: 'test-sol', displayName: 'Test Sol', isDefault: true }, { id: 'test-luna', displayName: 'Test Luna' }, { id: 'test-astra', displayName: 'Test Astra' }], modelVersionProvider: async () => 'test-cli-1',
  agentOverrides: { claude: { runner, sessionRunner: runner, statusProvider: async () => ({ available: true, authenticated: true, message: 'claude 테스트 로그인' }), modelVersionProvider: async () => 'claude-test-1',
    modelProvider: async () => [{ id: 'opus', displayName: 'Opus 5.5', description: 'Best for everyday, complex tasks', isDefault: true }, { id: 'sonnet', displayName: 'Sonnet 5.5' }, { id: 'claude-opus-5', displayName: 'Opus 5' }] } } });
app.use(express.static(path.join(projectRoot, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(projectRoot, 'dist/index.html')));
app.listen(4318, '127.0.0.1');
