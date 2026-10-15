import express from 'express';
import path from 'node:path';
import { createApp, projectRoot } from './app.mjs';
const { app, jobs, agents, codeIndexes, store } = await createApp({ onShutdown: shutdown });
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const j of jobs.values()) if (j.status === 'running') j.controller.abort();
  agents.close(); await codeIndexes.close();
  await store.flush();
  server.close(() => process.exit(0));
  server.closeIdleConnections();
}
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(projectRoot, 'dist')));
  app.get('*', (req, res) => res.sendFile(path.join(projectRoot, 'dist', 'index.html')));
}
const port = Number(process.env.PORT || 4317);
const server = app.listen(port, '127.0.0.1', () => console.log(`UE Reader: http://127.0.0.1:${server.address().port}`));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `포트 ${port}가 사용 중입니다. 실행 중인 앱을 확인하거나 PORT를 변경하세요.` : error.message); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
