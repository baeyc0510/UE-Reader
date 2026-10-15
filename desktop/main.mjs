import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, defaultDataDir, projectRoot } from '../server/app.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
app.setName('UE Reader');
app.setPath('userData', path.join(defaultDataDir, 'desktop-profile'));
let window, service, server, quitting = false, origin = '';
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('before-quit', event => { if (!quitting && window && !window.isDestroyed()) { event.preventDefault(); window.close(); } });
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
  app.whenReady().then(start).catch(async error => {
    await fs.mkdir(defaultDataDir, { recursive: true });
    await fs.writeFile(path.join(defaultDataDir, 'desktop-error.log'), error.stack || error.message);
    dialog.showErrorBox('UE Reader 실행 오류', error.message);
    quitting = true; service?.agents.close(); service?.codeIndexes.close(); server?.close(); app.quit();
  });
}

async function retireBrowserServer() {
  // Prevent two app versions from writing the same saved workspace concurrently.
  let data;
  try { data = await fetch('http://127.0.0.1:4317/api/bootstrap', { signal: AbortSignal.timeout(1500) }).then(r => r.json()); } catch { return; }
  if (path.resolve(data.dataDir || '.') !== path.resolve(defaultDataDir)) return;
  if (data.runningJobs?.length) throw Error('기존 브라우저 앱에서 진행 중인 질문·해설을 완료하거나 취소한 뒤 다시 실행하세요.');
  const control = await fetch('http://127.0.0.1:4317/api/lifecycle').then(r => r.json());
  if (!control.canShutdown) throw Error('기존 브라우저 앱을 종료한 뒤 다시 실행하세요.');
  const response = await fetch('http://127.0.0.1:4317/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: control.token }) });
  if (!response.ok) throw Error('기존 앱에서 저장 중인 작업을 마친 뒤 다시 실행하세요.');
  for (let i = 0; i < 40; i++) {
    try { await fetch('http://127.0.0.1:4317/api/health', { signal: AbortSignal.timeout(500) }); }
    catch { return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('기존 앱이 종료 중입니다. 잠시 후 다시 실행하세요.');
}

async function start() {
  await retireBrowserServer();
  service = await createApp({ onShutdown: shutdown });
  service.app.use(express.static(path.join(projectRoot, 'dist')));
  service.app.get('*', (req, res) => res.sendFile(path.join(projectRoot, 'dist/index.html')));
  server = service.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  origin = `http://127.0.0.1:${server.address().port}`;
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({ width: 1480, height: 980, minWidth: 720, minHeight: 600, title: 'UE Reader', backgroundColor: '#f6f7f8', show: false,
    webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) { event.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(false));
  window.on('close', event => {
    if (quitting) return;
    event.preventDefault(); window.webContents.send('reader:close-request');
  });
  window.webContents.on('render-process-gone', () => shutdown());
  window.once('ready-to-show', () => window.show());
  await window.loadURL(origin);
}

async function shutdown() {
  if (quitting) return;
  quitting = true;
  for (const job of service.jobs.values()) if (job.status === 'running') job.controller.abort();
  service.agents.close(); await service.codeIndexes.close();
  // Cancellation records must finish before closing the embedded backend.
  for (let i = 0; i < 100 && [...service.jobs.values()].some(j => j.status === 'running'); i++) await new Promise(resolve => setTimeout(resolve, 50));
  await service.store.flush();
  server.closeIdleConnections();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  window?.destroy(); app.quit();
}
