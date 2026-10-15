import { randomUUID } from 'node:crypto';

export function installLifecycle(app, { jobs, store, projectRoot, onShutdown }) {
  const token = randomUUID();
  let closing = false, writes = 0;
  app.use((req, res, next) => {
    if (closing) return res.status(503).json({ error: '앱을 종료하고 있습니다.' });
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      writes++;
      let released = false;
      const release = () => { if (!released) { released = true; writes--; } };
      res.once('finish', release); res.once('close', release);
    }
    next();
  });
  app.get('/api/lifecycle', (req, res) => res.json({ service: 'ue-reader', pid: process.pid, projectRoot, canShutdown: !!onShutdown, token: onShutdown ? token : null }));
  app.post('/api/shutdown', async (req, res, next) => {
    if (!onShutdown) return res.status(503).json({ error: '이 실행 환경에서는 종료 기능을 사용할 수 없습니다.' });
    if (req.body?.token !== token) return res.status(403).json({ error: '앱을 다시 열고 종료를 요청하세요.' });
    if ([...jobs.values()].some(j => j.status === 'running')) return res.status(409).json({ error: '진행 중인 질문·해설을 완료하거나 취소한 뒤 종료하세요.' });
    if ([...jobs.values()].some(j => j.status === 'save_failed')) return res.status(409).json({ error: '저장하지 못한 응답이 있습니다. 다시 저장한 뒤 종료하세요.' });
    if (writes > 1) return res.status(409).json({ error: '다른 작업을 저장하고 있습니다. 잠시 후 다시 종료하세요.' });
    closing = true;
    try {
      await store.flush();
      res.once('finish', () => onShutdown());
      res.json({ ok: true });
    } catch (error) { closing = false; next(error); }
  });
}
