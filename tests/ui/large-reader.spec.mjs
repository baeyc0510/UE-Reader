import { test, expect } from '@playwright/test';

async function mockWorkspace(page, { source, files, notes = [], partial = false }) {
  const path = 'Many/Unit25000.cpp', id = 'large-fixture';
  await page.route('**/api/bootstrap', route => route.fulfill({ json: {
    activeWorkspace: id, workspaces: [{ id, root: 'D:/fixture', name: '대규모 소스', version: 'test' }],
    settings: {}, dataDir: 'test', runningJobs: [],
    sessions: { [id]: { active: path, tabs: [path], expandedFolders: ['Many'], sidebar: true } },
  } }));
  await page.route(`**/api/workspaces/${id}/session`, route => route.fulfill({ json: { ok: true } }));
  await page.route(`**/api/workspaces/${id}/conversations`, route => route.fulfill({ json: [] }));
  await page.route(`**/api/workspaces/${id}/chats`, route => route.fulfill({ json: [] }));
  await page.route(`**/api/workspaces/${id}/file?*`, route => route.fulfill({ json: { source: { path, text: source, lines: source.split('\n').length, hash: 'fixture' }, notes } }));
  let calls = 0;
  await page.route(`**/api/workspaces/${id}/files?*`, async route => {
    const loading = partial && ++calls === 1;
    await route.fulfill({ json: { files: loading ? [] : files, count: loading ? 0 : files.length, total: loading ? 0 : files.length, status: loading ? 'indexing' : 'ready', revision: loading ? 'loading' : 'ready', skipped: 0 } });
  });
}

test('50,000 files reveal immediate neighbors with bounded DOM and responsive filtering', async ({ page }) => {
  const files = Array.from({ length: 50000 }, (_, i) => `Many/Unit${String(i).padStart(5, '0')}.cpp`);
  await mockWorkspace(page, { source: 'void Test() {}', files, partial: true });
  await page.goto('/');
  await expect(page.locator('.virtual-tree')).toHaveAttribute('data-row-count', '50001');
  await expect(page.locator('.tree-file.active')).toBeVisible();
  await expect(page.locator('.tree-file button[title="Many/Unit24999.cpp"]')).toBeVisible();
  await expect(page.locator('.tree-file button[title="Many/Unit25001.cpp"]')).toBeVisible();
  expect(await page.locator('.virtual-tree-row').count()).toBeLessThan(60);
  await expect(page.getByText(/파일 더 보기/)).toHaveCount(0);
  await page.locator('.tree-viewport').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('.tree-file button[title="Many/Unit49999.cpp"]')).toBeVisible();
  expect(await page.locator('.virtual-tree-row').count()).toBeLessThan(60);
  await page.getByRole('button', { name: '현재 파일 위치 표시', exact: true }).click();
  await expect(page.locator('.tree-file.active')).toBeVisible();
  await page.getByPlaceholder('파일 이름으로 필터').fill('Unit49999');
  await expect(page.locator('.virtual-tree')).toHaveAttribute('data-row-count', '2');
  await expect(page.locator('.tree-file')).toHaveCount(1);
  await page.locator('[data-folder="Many"] > summary').click();
  await expect(page.locator('.tree-file')).toHaveCount(0);
  await page.locator('[data-folder="Many"] > summary').click();
  await expect(page.locator('.tree-file')).toHaveCount(1);
  await page.getByRole('textbox', { name: '코드 질문', exact: true }).fill('대규모 목록에서도 입력');
  await expect(page.getByRole('textbox', { name: '코드 질문', exact: true })).toHaveValue('대규모 목록에서도 입력');
  await page.getByRole('button', { name: '현재 파일 위치 표시', exact: true }).click();
  await expect(page.locator('.tree-file.active')).toBeVisible();
  await page.screenshot({ path: '.runtime/large-explorer.png', fullPage: true });
});

test('C++ multiline tokens keep state across virtual rows and both themes are readable', async ({ page }) => {
  const source = [
    '/* comment begins', '  if (false) UCLASS() <script>', 'comment ends */',
    'const char* Text = R"tag(first', '  return FVector();', 'last)tag";',
    '#include "CoreMinimal.h"', 'UCLASS()', 'class AActor : public UObject {',
    '  int32 Count = 42;', '  void Tick() { AnalyzeReferences(); }', '};',
  ].join('\n');
  await mockWorkspace(page, { source, files: ['Many/Unit25000.cpp'] });
  await page.goto('/');
  await expect(page.locator('[data-line="2"] .hljs-comment')).toContainText('if (false) UCLASS() <script>');
  await expect(page.locator('[data-line="2"] .hljs-keyword')).toHaveCount(0);
  await expect(page.locator('[data-line="5"] .hljs-string')).toContainText('return FVector()');
  await expect(page.locator('[data-line="8"] .hljs-macro')).toHaveText('UCLASS');
  await expect(page.locator('[data-line="10"] .hljs-type')).toHaveText('int32');
  await expect(page.locator('.code-viewport script')).toHaveCount(0);
  await page.screenshot({ path: '.runtime/cpp-light.png', fullPage: true });
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByLabel('화면 테마', { exact: true }).selectOption('dark');
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.locator('[data-line="2"] .hljs-comment')).toHaveCSS('color', 'rgb(163, 180, 168)');
  await page.screenshot({ path: '.runtime/cpp-dark.png', fullPage: true });
});

test('linked navigation aligns the last explanation and source near the top', async ({ page }) => {
  const path = 'Many/Unit25000.cpp';
  const notes = [{ id: 'first', start: 2, end: 4 }, { id: 'last', start: 190, end: 200 }].map(n => ({
    ...n, path, title: n.id, body: '함수 해설입니다.', summary: '테스트', selected: true, sourceState: 'same', evidence: [], createdAt: new Date().toISOString(),
  }));
  await mockWorkspace(page, { source: Array.from({ length: 200 }, (_, i) => `// line ${i + 1}`).join('\n'), files: [path], notes });
  await page.goto('/');
  await page.locator('.outline > summary').click();
  await page.locator('.outline').getByRole('button', { name: /last/ }).click();
  await expect(page.locator('.note-card.active')).toContainText('last');
  const codeInset = await page.locator('[data-line="190"]').evaluate(el => el.getBoundingClientRect().top - el.closest('.code-viewport').getBoundingClientRect().top);
  const noteInset = await page.locator('[data-note="last"]').evaluate(el => el.getBoundingClientRect().top - el.closest('.notes-scroll').getBoundingClientRect().top);
  expect(codeInset).toBeGreaterThan(20); expect(codeInset).toBeLessThanOrEqual(65);
  expect(noteInset).toBeGreaterThan(20); expect(noteInset).toBeLessThanOrEqual(65);
});

test('gutter dragging autoscrolls across virtual source rows and selected lines toggle off', async ({ page }) => {
  const path = 'Many/Unit25000.cpp';
  await mockWorkspace(page, { source: Array.from({ length: 500 }, (_, i) => `// source line ${i + 1}`).join('\n'), files: [path] });
  await page.goto('/');
  const viewport = page.locator('.code-viewport');
  const start = await page.getByRole('button', { name: '10행 선택', exact: true }).boundingBox();
  const box = await viewport.boundingBox();
  await page.mouse.move(start.x + 15, start.y + 8); await page.mouse.down();
  await page.mouse.move(start.x + 15, box.y + box.height + 25, { steps: 6 });
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(400);
  await page.mouse.up();
  await expect(page.locator('.code-line.selected')).not.toHaveCount(0);
  await expect(page.locator('.context-chips')).toContainText(/L10–\d+/);
  await page.locator('.code-line.selected .line-number').last().click();
  await expect(page.locator('.code-line.selected')).toHaveCount(0);
});

test('scrolling and hovering never rebuild explanation cards; scroll positions are saved once scrolling pauses', async ({ page }) => {
  const path = 'Many/Unit25000.cpp';
  const text = n => `**${n}단계**: \`FReferenceCollector\`로 순회합니다. [\`Mark\`](source:${path}#L${n + 1})\n\n| 플래그 | 의미 |\n| --- | --- |\n| \`Unreachable\` | 미도달 |`;
  const notes = Array.from({ length: 12 }, (_, k) => ({ id: `n${k}`, groupId: `n${k}`, revision: 1, path, start: k * 40 + 1, end: k * 40 + 30, title: `해설 ${k}`, overview: text(k),
    details: [0, 1, 2].map(d => ({ title: `블록 ${d}`, text: text(k * 10 + d), start: k * 40 + 1 + d * 9, end: k * 40 + 9 + d * 9 })),
    body: '', summary: '요약', selected: true, sourceState: 'same', evidence: [], snapshot: '', createdAt: new Date().toISOString(), order: k }));
  const saved = [];
  await mockWorkspace(page, { source: Array.from({ length: 500 }, (_, i) => `// line ${i + 1}`).join('\n'), files: [path], notes });
  await page.route('**/api/workspaces/large-fixture/session', async route => { saved.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true } }); });
  await page.goto('/');
  await expect(page.locator('.note-card')).toHaveCount(12);
  await expect(page.locator('.md-table')).toHaveCount(48);
  // Memoized cards and Markdown: linked scrolling and sentence hover only toggle attributes, never rebuild nodes.
  await page.locator('.notes-scroll').evaluate(el => { window.__rebuilt = 0; new MutationObserver(list => { window.__rebuilt += list.filter(m => m.type === 'childList').length; }).observe(el, { childList: true, subtree: true }); });
  await page.locator('.code-viewport').evaluate(async el => { for (let i = 0; i < 20; i++) { el.scrollTop += 120; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); } });
  await page.locator('.note-sentence').nth(4).hover(); await page.locator('.note-sentence').nth(7).hover();
  await expect(page.locator('.sentence-highlight')).not.toHaveCount(0);
  expect(await page.evaluate(() => window.__rebuilt)).toBe(0);
  // The pause commits the latest position; a source link inside Markdown still navigates.
  const top = await page.locator('.code-viewport').evaluate(el => el.scrollTop);
  await expect.poll(() => saved.at(-1)?.positions?.[path]?.code).toBe(top);
  await page.locator('.note-card').first().locator('button.inline-link').first().click();
  await expect(page.locator('[data-line="2"]')).toBeVisible();
});

test('typing stays inside the composer until a pause, and a ready code index is not polled every few seconds', async ({ page }) => {
  const path = 'Many/Unit25000.cpp', saves = [];
  let polls = 0;
  await mockWorkspace(page, { source: '// line 1', files: [path] });
  await page.route('**/api/workspaces/large-fixture/code-index', route => { polls++; return route.fulfill({ json: { status: 'ready', processed: 1, total: 1, parsed: 0, files: 1, symbols: 1, tokens: 1, builtAt: null, error: '' } }); });
  await page.route('**/api/workspaces/large-fixture/session', async route => { saves.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true } }); });
  await page.goto('/');
  const box = page.getByRole('textbox', { name: '코드 질문', exact: true }), state = page.locator('.statusbar button').filter({ hasText: /저장/ });
  await box.click();
  await expect(state).toContainText('저장됨');
  const start = polls;
  // Per-key updates of the reader's session would show "저장 중" while typing.
  await page.keyboard.type('inventory system', { delay: 40 });
  expect(await state.textContent()).toContain('저장됨');
  await expect(box).toHaveValue('inventory system');
  // After a pause the draft reaches the session and is saved.
  await expect.poll(() => saves.at(-1)?.questionDraft).toBe('inventory system');
  await page.waitForTimeout(4500);
  expect(polls - start).toBeLessThanOrEqual(1);
});
