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
