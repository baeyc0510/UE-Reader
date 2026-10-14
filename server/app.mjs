// Composition root: builds the store, agents and shared services, then mounts the route modules.
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store/store.mjs';
import { readSource, locateNote, makeIndex, fail } from './source/source.mjs';
import { createCodeIndexes } from './source/code-index/service.mjs';
import { createAgentIndex } from './source/agent-index.mjs';
import { createAgents } from './agents/registry.mjs';
import { publicSettings } from './domain/settings.mjs';
import { localOnly, errorHandler } from './http/security.mjs';
import { installLifecycle } from './http/lifecycle.mjs';
import { settingsRoutes } from './routes/settings.mjs';
import { agentRoutes } from './routes/agents.mjs';
import { workspaceRoutes } from './routes/workspaces.mjs';
import { noteRoutes } from './routes/notes.mjs';
import { chatRoutes } from './routes/chats.mjs';
import { jobRoutes } from './routes/jobs.mjs';
import { codeIndexRoutes } from './routes/code-index.mjs';
import { attachmentRoutes } from './routes/attachments.mjs';
import { publicJob } from './analysis/generation.mjs';
import { createAttachments } from './analysis/attachments.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const defaultDataDir = process.env.UE_READER_DATA || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'UEReader');

/**
 * Test seams. Codex: runner, sessionRunner, sessionConnect, statusProvider, modelProvider, modelVersionProvider, usageProvider.
 * Other agents: agentOverrides = { claude: { runner, ... } }. codeIndex: false skips the code index workers.
 */
export async function createApp({ dataDir = defaultDataDir, onShutdown, agentOverrides = {}, codeIndex = true, runner, sessionRunner, sessionConnect, statusProvider, modelProvider, modelVersionProvider, usageProvider } = {}) {
  const store = await new Store(dataDir).init();
  const codex = Object.fromEntries(Object.entries({ runner, sessionRunner, sessionConnect, statusProvider, modelProvider, modelVersionProvider, usageProvider }).filter(([, v]) => v));
  const agents = createAgents({ store, dataDir, overrides: { ...agentOverrides, codex: { ...codex, ...agentOverrides.codex } } });
  const indexes = new Map(), jobs = new Map(), codeIndexes = codeIndex ? createCodeIndexes({ dataDir }) : { get: () => null, peek: () => null, close: async () => {} };
  const runningJobs = () => [...jobs.values()].filter(j => j.status === 'running');
  const workspace = id => {
    if (id === 'general') return { id, root: null, name: '일반 질문', version: '미확인' };
    const w = store.data.workspaces.find(w => w.id === id); if (!w) throw fail('작업공간을 찾을 수 없습니다.', 404); return w;
  };
  // Opening a workspace's file index also starts (or reuses) its saved code index.
  const getIndex = w => { if (!w.root) throw fail('소스 작업공간을 먼저 지정하세요.'); if (!indexes.has(w.id)) { indexes.set(w.id, makeIndex(w)); codeIndexes.get(w); } return indexes.get(w.id); };
  const fileNotes = async (w, relative) => {
    const notes = store.data.notes.filter(n => n.workspaceId === w.id && n.path === relative && !n.deletedAt);
    try { const source = await readSource(w, relative); return { source, notes: notes.map(n => locateNote(n, source)) }; }
    catch (error) { if (notes.length) return { source: null, notes: notes.map(n => ({ ...n, sourceState: 'missing' })), error: error.message }; throw error; }
  };
  const agentIndex = createAgentIndex({ workspace, getIndex, codeIndexes });
  const ctx = { store, agents, jobs, indexes, codeIndexes, agentIndex, dataDir, projectRoot, workspace, getIndex, fileNotes, runningJobs, attachments: createAttachments() };

  const app = express();
  app.disable('x-powered-by');
  app.use(localOnly);
  app.use(express.json({ limit: '2mb' }));
  installLifecycle(app, { jobs, store, projectRoot, onShutdown });
  app.get('/api/health', (req, res) => res.json({ service: 'ue-reader', version: 1 }));
  app.get('/api/bootstrap', (req, res) => {
    const { notes, conversations, chats, modelCatalogs, agentSessions, ...data } = store.data;
    res.json({ ...data, settings: publicSettings(store), agents: agents.describe(), dataDir, runningJobs: runningJobs().map(publicJob) });
  });
  settingsRoutes(app, ctx);
  agentRoutes(app, ctx);
  workspaceRoutes(app, ctx);
  noteRoutes(app, ctx);
  chatRoutes(app, ctx);
  jobRoutes(app, ctx);
  codeIndexRoutes(app, ctx);
  attachmentRoutes(app, ctx);
  app.use('/api',(req, res) => res.status(404).json({ error: 'API 경로를 찾을 수 없습니다.' }));
  app.use(errorHandler);
  return { app, store, jobs, indexes, codeIndexes, agents };
}
