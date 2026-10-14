import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ue-reader-desktop-'));
const env = { ...process.env, UE_READER_DATA: dataDir }; delete env.ELECTRON_RUN_AS_NODE;
let instance;
try {
  instance = await electron.launch({ ...(process.env.UE_READER_DESKTOP_EXE ? { executablePath: process.env.UE_READER_DESKTOP_EXE, args: [] } : { args: ['.'] }), env, timeout: 30000 });
  const page = await instance.firstWindow();
  await expect(page.getByRole('textbox', { name: '코드 질문', exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const lifecycle = await fetch(origin + '/api/lifecycle').then(r => r.json());
  assert.equal(lifecycle.pid, await instance.evaluate(() => process.pid), 'backend must run inside the desktop main process');
  await page.getByRole('button', { name: '예제로 둘러보기', exact: true }).click();
  await expect(page.locator('.tree-file.active')).toBeVisible();
  await expect(page.locator('.tree-viewport')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.code-line .hljs-keyword').first()).toBeVisible();
  await page.getByRole('textbox', { name: '코드 질문', exact: true }).fill('데스크톱 창을 닫을 때 저장할 질문');
  await page.screenshot({ path: '.runtime/desktop-app.png', fullPage: true });
  const exited = new Promise(resolve => instance.process().once('exit', resolve));
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await Promise.race([exited, new Promise((_, reject) => { const t = setTimeout(() => reject(Error('Window close did not stop the app')), 15000); t.unref(); })]);
  const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'reader.json'), 'utf8'));
  assert.equal(saved.sessions[saved.activeWorkspace].questionDraft, '데스크톱 창을 닫을 때 저장할 질문');
  await assert.rejects(fetch(origin + '/api/health'));
  console.log('Desktop window, embedded backend, tree/syntax workers, draft save, and process shutdown passed.');
} finally {
  await instance?.close().catch(() => {});
  await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
