import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function openDemo(page) {
  const boot = await page.request.get('/api/bootstrap').then(r => r.json());
  let demo = boot.workspaces.find(w => w.demo);
  if (!demo) demo = await page.request.post('/api/workspaces', { data: { demo: true } }).then(r => r.json());
  await page.request.post(`/api/workspaces/${demo.id}/activate`);
  await page.goto('/');
  await page.getByRole('tab', { name: /질문과 답변/ }).click();
}
const composer = page => page.getByRole('textbox', { name: '코드 질문', exact: true });

test('a new chat is titled by its first answer, renamed and deleted from the right-click menu, and restored', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openDemo(page);
  if (await page.getByRole('button', { name: '새 채팅' }).isEnabled()) await page.getByRole('button', { name: '새 채팅' }).click();
  await expect(page.locator('.chat-title')).toHaveText('새 채팅');
  await expect(page.locator('.conversation')).toHaveCount(0);
  await composer(page).fill('Tick에서 회전은 어떻게 계산되나요?');
  await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await expect(page.locator('.chat-title')).toHaveText('Tick에서 회전은 어떻게 계산되나요?');
  await expect(page.locator('.conversation .answer').last()).toContainText('Tick에서 회전량');
  await expect(page.locator('.chat-title')).toHaveText('회전 구현');

  await page.getByRole('button', { name: '채팅 목록' }).click();
  const list = page.getByRole('list', { name: '채팅 목록' });
  const item = list.locator('.chat-item.active button');
  await expect(item).toContainText('회전 구현');
  await item.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '이름 편집' }).click();
  await page.getByRole('textbox', { name: '채팅 이름', exact: true }).fill('내 회전 메모');
  await page.getByRole('textbox', { name: '채팅 이름', exact: true }).press('Enter');
  await expect(page.locator('.chat-title')).toHaveText('내 회전 메모');

  const count = await list.locator('.chat-item').count();
  await list.locator('.chat-item.active button').focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await list.locator('.chat-item.active button').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '삭제' }).click();
  await expect(list.locator('.chat-item')).toHaveCount(count - 1);
  await expect(page.locator('.chat-title')).toHaveText('새 채팅');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(list.locator('.chat-item')).toHaveCount(count);
  await list.getByRole('button', { name: /내 회전 메모/ }).click();
  await expect(page.locator('.conversation')).toHaveCount(1);

  await page.reload();
  await page.getByRole('tab', { name: /질문과 답변/ }).click();
  await expect(page.locator('.chat-title')).toHaveText('내 회전 메모');
  await page.locator('.chat-title').dblclick();
  await page.getByRole('textbox', { name: '현재 채팅 이름', exact: true }).fill('헤더에서 바꾼 이름');
  await page.getByRole('textbox', { name: '현재 채팅 이름', exact: true }).press('Enter');
  await expect(page.locator('.chat-title')).toHaveText('헤더에서 바꾼 이름');
  await page.screenshot({ path: '.runtime/chats.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('switching chats shows only that chat, and follow-up questions stay in the selected chat', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: '새 채팅' }).click();
  await composer(page).fill('두 번째 채팅의 질문');
  await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await expect(page.locator('.conversation .answer').last()).toContainText('Tick에서 회전량');
  await expect(page.locator('.conversation')).toHaveCount(1);
  await page.getByRole('button', { name: '채팅 목록' }).click();
  await page.getByRole('list', { name: '채팅 목록' }).getByRole('button', { name: /헤더에서 바꾼 이름/ }).click();
  await expect(page.locator('.conversation')).toHaveCount(1);
  await expect(page.locator('.conversation .question')).toContainText('Tick에서 회전은 어떻게');
  await composer(page).fill('같은 채팅의 후속 질문');
  await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await expect(page.locator('.conversation')).toHaveCount(2);
  await expect(page.locator('.live-conversation')).toHaveCount(0);
  await expect(page.locator('.chat-title')).toHaveText('헤더에서 바꾼 이름');
});

test('the answering agent and its model are chosen in settings and label new answers', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: '응답 모델 설정', exact: true }).click();
  await page.getByLabel('응답 에이전트', { exact: true }).selectOption('claude');
  await expect(page.locator('.connection-box')).toContainText('claude 테스트 로그인');
  const model = page.getByLabel('응답 모델', { exact: true });
  await expect(model.locator('option')).toHaveCount(4);
  await expect(model.locator('option').first()).toHaveText('Claude Code 기본값 · Opus 5.5');
  await model.selectOption('claude-opus-5');
  await expect(model).toBeEnabled();
  await expect.poll(async () => (await page.request.get('/api/bootstrap').then(r => r.json())).settings.models.claude).toBe('claude-opus-5');
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByRole('button', { name: '응답 모델 설정', exact: true })).toContainText('Claude Code · claude-opus-5');
  await expect(page.getByLabel('Claude Code 남은 사용량')).toContainText('지원하지 않습니다');
  await composer(page).fill('Claude로 보내는 질문');
  await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await expect(page.locator('.live-conversation')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('.conversation').last()).toContainText('Claude Code · claude-opus-5');
  await page.getByRole('button', { name: '응답 모델 설정', exact: true }).click();
  await page.getByLabel('응답 에이전트', { exact: true }).selectOption('codex');
  await expect(page.getByLabel('응답 모델', { exact: true }).locator('option', { hasText: 'Opus 5' })).toHaveCount(0);
  await expect(page.getByLabel('응답 에이전트', { exact: true }).locator('option')).toHaveCount(2);
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.locator('.codex-status')).toContainText('Codex');
});

test('saved explanations open a file list first, then the explanations of the chosen file', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: '저장한 해설', exact: true }).click();
  await expect(page.locator('.saved-files>button').first()).toContainText('ReadingActor.cpp');
  await expect(page.locator('.saved-list')).toHaveCount(0);
  await page.locator('.saved-files>button').filter({ hasText: 'ReadingActor.cpp' }).click();
  await expect(page.getByRole('heading', { name: /저장한 해설 · ReadingActor.cpp/ })).toBeVisible();
  await expect(page.locator('.saved-list>article').first()).toBeVisible();
  await page.getByRole('button', { name: '파일 목록으로', exact: true }).click();
  await expect(page.locator('.saved-files')).toBeVisible();
});

test('right-click on code goes to a definition through the code index and searches references', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('tab', { name: 'ReadingActor.cpp', exact: true }).click();
  await expect(page.locator('.code-index-status')).toContainText('심볼', { timeout: 15000 });
  await page.locator('.code-viewport').evaluate(el => { el.scrollTop = 0; });
  const target = await page.locator('[data-line="8"] code').boundingBox();
  await page.mouse.click(target.x + 4, target.y + target.height / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: /정의로 이동 · AReadingActor/ }).click();
  await expect(page.getByRole('tab', { name: 'ReadingActor.h', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.locator('.code-viewport').evaluate(el => { el.scrollTop = 0; });
  const header = await page.locator('[data-line="10"] code').boundingBox();
  await page.mouse.click(header.x + 4, header.y + header.height / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: /모든 참조 검색/ }).click();
  await expect(page.locator('.search-meta')).toContainText('코드 인덱스로');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+t');
  await page.getByPlaceholder('타입, 함수, 변수, 매크로 이름').fill('BeginPlay');
  await expect(page.locator('.search-results .symbol-kind').first()).toBeVisible();
});

// Right-clicks the first occurrence of `word` on a source line, scrolling it into view first.
async function rightClickWord(page, line, word) {
  await page.locator('.code-viewport').evaluate((el, n) => { el.scrollTop = Math.max(0, (n - 3) * parseFloat(getComputedStyle(el).lineHeight)); }, line);
  const box = await page.locator(`[data-line="${line}"] code`).evaluate((code, w) => {
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent.indexOf(w);
      if (at >= 0) { const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + w.length); const r = range.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
    }
    return null;
  }, word);
  await page.mouse.click(box.x, box.y, { button: 'right' });
}

test('go to definition finds member variables in the class header and locals in the enclosing function', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('tab', { name: 'ReadingActor.cpp', exact: true }).click();
  await expect(page.locator('.code-index-status')).toContainText('심볼', { timeout: 15000 });
  await rightClickWord(page, 40, 'DeltaYaw');
  await page.getByRole('menuitem', { name: /정의로 이동 · DeltaYaw/ }).click();
  await expect(page.getByRole('tab', { name: 'ReadingActor.cpp', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-line="39"]')).toBeInViewport();
  await expect(page.locator('[data-line="39"].flash-line')).toHaveCount(1);
  await rightClickWord(page, 26, 'bReady');
  await page.getByRole('menuitem', { name: /정의로 이동 · bReady/ }).click();
  await expect(page.getByRole('tab', { name: 'ReadingActor.h', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-line="28"]')).toBeInViewport();
  await expect(page.locator('[data-line="28"].flash-line')).toHaveCount(1);
  await expect(page.locator('.flash-line')).toHaveCount(0, { timeout: 4000 });
});

test('tabs close with the middle button and the tab menu, and Ctrl+Shift+T reopens the last closed tab', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('tab', { name: 'ReadingActor.cpp', exact: true }).click();
  await page.getByRole('button', { name: '헤더·구현 파일 전환' }).click();
  const tabs = page.getByRole('tablist', { name: '열린 파일' }).getByRole('tab');
  await expect(page.getByRole('tab', { name: 'ReadingActor.h', exact: true })).toHaveAttribute('aria-selected', 'true');
  const before = await tabs.count();
  await page.getByRole('tab', { name: 'ReadingActor.h', exact: true }).click({ button: 'middle' });
  await expect(tabs).toHaveCount(before - 1);
  await page.locator('.code-viewport').click();
  await page.keyboard.press('Control+Shift+T');
  await expect(page.getByRole('tab', { name: 'ReadingActor.h', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'ReadingActor.h', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /오른쪽 탭 닫기/ })).toBeDisabled();
  await page.getByRole('menuitem', { name: /다른 탭 모두 닫기/ }).click();
  await expect(tabs).toHaveCount(1);
  await page.getByRole('tab', { name: 'ReadingActor.h', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /모든 탭 닫기/ }).click();
  await expect(tabs).toHaveCount(0);
  await page.keyboard.press('Control+Shift+T'); await page.keyboard.press('Control+Shift+T');
  await expect(page.getByRole('tab', { name: 'ReadingActor.cpp', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('saved explanations are refined by the agent with a request and options, and the result is shown', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('tab', { name: 'ReadingActor.cpp', exact: true }).click();
  await page.getByRole('tab', { name: /코드 해설/ }).click();
  await page.getByRole('button', { name: '해설 다듬기', exact: true }).click();
  const files = page.getByRole('group', { name: '다듬을 파일' });
  await expect(files.getByRole('checkbox').first()).toBeChecked();
  await page.getByRole('textbox', { name: '다듬기 요청' }).fill('초보자 관점으로 보강해 주세요.');
  await page.getByRole('checkbox', { name: /불필요한 해설 삭제/ }).check();
  await page.getByRole('button', { name: '다듬기 시작' }).click();
  await expect(page.locator('.explanation-progress')).toContainText('해설 다듬기');
  await expect(page.getByRole('list', { name: '에이전트 진행 상황' })).toContainText('소스 검색');
  await expect(page.locator('.explanation-progress')).toContainText('수정 1', { timeout: 15000 });
  await expect(page.locator('.refine-summary')).toContainText('첫 해설을 더 쉽게');
  await expect(page.locator('.notes-scroll')).toContainText('(다듬음)');
  // Later specs read the sample notes: select the original revisions again.
  const demo = (await page.request.get('/api/bootstrap').then(r => r.json())).workspaces.find(w => w.demo);
  const notes = await page.request.get(`/api/workspaces/${demo.id}/notes?path=Source/ReaderDemo/Private/ReadingActor.cpp`).then(r => r.json());
  for (const n of notes.filter(n => !n.selected && n.revision === 1 && notes.some(v => v.groupId === n.groupId && v.selected))) await page.request.patch(`/api/notes/${n.id}`, { data: { selected: true } });
});

test('a project folder is added next to the main folder, browsed in the explorer and removed again', async ({ page }) => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'ue-reader-project-'));
  await fs.mkdir(path.join(project, 'Source')); await fs.writeFile(path.join(project, 'Source', 'MyPawn.cpp'), 'class AMyPawn\n{\n};\n');
  try {
    await openDemo(page);
    await page.getByRole('button', { name: '작업공간 폴더 관리' }).click();
    await page.getByRole('textbox', { name: '추가할 폴더 경로' }).fill(project);
    await page.getByRole('textbox', { name: '폴더 표시 이름' }).fill('GameProj');
    await page.getByRole('button', { name: '폴더 추가' }).click();
    await expect(page.getByRole('list', { name: '작업공간 폴더' })).toContainText('GameProj/');
    await page.keyboard.press('Escape');
    await expect(page.locator('.explorer-folders')).toContainText('GameProj');
    await page.getByPlaceholder('파일 이름으로 필터').fill('MyPawn');
    await page.locator('.tree-file').filter({ hasText: 'MyPawn.cpp' }).first().click();
    await expect(page.getByRole('tab', { name: 'MyPawn.cpp', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.breadcrumb .path')).toContainText('GameProj');
    await page.getByRole('button', { name: '작업공간 폴더 관리' }).click();
    await page.getByRole('button', { name: 'GameProj 폴더 제거' }).click();
    await expect(page.getByRole('list', { name: '작업공간 폴더' })).not.toContainText('GameProj');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'MyPawn.cpp', exact: true }).click({ button: 'middle' });
  } finally { await fs.rm(project, { recursive: true, force: true }); }
});

test('extended thinking is toggled next to the model, shows research notes and reviews explanations', async ({ page }) => {
  await openDemo(page);
  try {
    if (await page.getByRole('button', { name: '새 채팅' }).isEnabled()) await page.getByRole('button', { name: '새 채팅' }).click();
    const toggle = page.getByRole('button', { name: '확장된 사고', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await composer(page).fill('회전은 어떻게 계산하나요?');
    await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
    const answer = page.locator('.conversation').last();
    await expect(answer.locator('small').first()).toContainText('확장된 사고', { timeout: 10000 });
    await expect(answer.locator('.research-notes summary')).toContainText('조사 결과 1개');
    await answer.locator('.research-notes summary').click();
    await expect(answer.locator('.research-notes')).toContainText('Tick은 준비 상태를 확인한 뒤');
    await answer.getByLabel('해설 대상 파일', { exact: true }).selectOption('Source/ReaderDemo/Private/ReadingActor.cpp');
    await answer.getByRole('button', { name: '코드 해설 생성', exact: true }).click();
    await expect(page.locator('.explanation-progress')).toContainText('확장된 사고 검토: 수정 1', { timeout: 10000 });
    await expect(page.locator('.explanation-progress')).toContainText('첫 해설의 개요를 보충했습니다.');
    await expect(page.getByRole('heading', { name: '회전 처리 (검토)', exact: true }).first()).toBeVisible();
    await page.screenshot({ path: '.runtime/extended-thinking.png' });
    await page.reload();
    await expect(page.getByRole('button', { name: '확장된 사고', exact: true })).toHaveAttribute('aria-pressed', 'true');
  } finally { await page.request.put('/api/settings/extended-thinking', { data: { enabled: false } }); }
});

test('asking in chat for a code explanation picks the file, saves the explanation and opens it', async ({ page }) => {
  await openDemo(page);
  if (await page.getByRole('button', { name: '새 채팅' }).isEnabled()) await page.getByRole('button', { name: '새 채팅' }).click();
  await composer(page).fill('회전 처리 코드 해설 만들어 줘');
  await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await expect(page.getByRole('tab', { name: '코드 해설', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
  await expect(page.getByRole('heading', { name: '회전 처리 (채팅 요청)', exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: /질문과 답변/ }).click();
  const answer = page.locator('.conversation').last();
  await expect(answer).toContainText('`ReadingActor.cpp`를 골라'.replaceAll('`', ''));
  await expect(answer.locator('.answer-explanations')).toContainText('ReadingActor.cpp');
});

test('agent roles are edited in settings, and a search scope picked in the explorer goes with requests', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const role = page.getByLabel('답변·해설 역할', { exact: true });
  await expect(role).toHaveValue(/game projects/);
  await role.fill('당신은 게임플레이 프로그래머입니다.');
  await page.getByRole('button', { name: '역할 저장', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '다음 요청부터 적용' })).toBeVisible();
  expect((await page.request.get('/api/settings/roles').then(r => r.json())).role).toBe('당신은 게임플레이 프로그래머입니다.');
  await page.getByRole('button', { name: '기본 역할로 복원', exact: true }).click();
  await expect(role).toHaveValue(/game projects/);
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  // Scope: right-click a file in the explorer, see it in the composer, and send it with the question.
  await expect(page.getByLabel('에이전트 검색 범위')).toContainText('작업공간 전체');
  const file = page.locator('.tree-file.active>button').first();
  const name = (await file.getAttribute('title')).split(' · ')[0];
  await file.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '에이전트 검색 범위에 추가' }).click();
  await expect(page.getByLabel('에이전트 검색 범위')).toContainText(name.split('/').pop());
  await expect(page.locator('.tree-file.active')).toHaveClass(/in-search-scope/);
  const sent = page.waitForRequest(r => r.url().endsWith('/generate') && r.method() === 'POST');
  await composer(page).fill('검색 범위 안에서 회전 처리를 찾아 주세요');
  await page.getByRole('button', { name: '질문 보내기' }).click();
  expect((await sent).postDataJSON().searchScope).toEqual([name]);
  await page.getByRole('button', { name: '중지' }).click().catch(() => {});
  await page.getByLabel('에이전트 검색 범위').getByRole('button', { name: '전체로' }).click();
  await expect(page.getByLabel('에이전트 검색 범위')).toContainText('작업공간 전체');
});
