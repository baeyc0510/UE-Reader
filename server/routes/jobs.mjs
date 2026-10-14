// Background agent requests: start (generate), poll, cancel, retry a failed save.
import { asyncRoute } from '../http/security.mjs';
import { fail } from '../source/source.mjs';
import { generationHandler, publicJob } from '../analysis/generation.mjs';

export function jobRoutes(app, ctx) {
  const { jobs } = ctx;
  app.post('/api/workspaces/:id/generate', asyncRoute(generationHandler(ctx)));
  app.get('/api/jobs/:id', (req, res) => { const j = jobs.get(req.params.id); j ? res.json(publicJob(j)) : res.status(404).json({ error: '요청을 찾을 수 없습니다.' }); });
  app.post('/api/jobs/:id/cancel', (req, res) => { const j = jobs.get(req.params.id); if (j?.status === 'running') j.controller.abort(); res.json({ ok: true }); });
  app.post('/api/jobs/:id/retry-save', asyncRoute(async (req, res) => {
    const j = jobs.get(req.params.id); if (!j?.save) throw fail('다시 저장할 결과가 없습니다.'); await j.save(); j.status = 'complete'; j.error = null; res.json(publicJob(j));
  }));
}
