// Agent CLI information: list, login status, model catalog and remaining usage.
import { asyncRoute } from '../http/security.mjs';

export function agentRoutes(app, { agents }) {
  app.get('/api/agents', (req, res) => res.json(agents.describe()));
  app.get('/api/agents/:agent/status', asyncRoute(async (req, res) => res.json(await agents.get(req.params.agent).status())));
  app.get('/api/agents/:agent/models', asyncRoute(async (req, res) => res.json(await agents.get(req.params.agent).catalog.get(req.query.refresh === '1'))));
  app.get('/api/agents/:agent/usage', asyncRoute(async (req, res) => res.json(await agents.usage(req.params.agent, req.query.refresh === '1'))));
}
