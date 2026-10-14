// Retained sessions for agents that resume by re-running the CLI (Claude Code).
// Each chat (sessionKey) owns a working folder; the CLI keeps the transcript, the store keeps the id.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { scopeKey } from '../source/source.mjs';

export function createCliSessions({ store, agentId, runTurn }) {
  async function run(options) {
    const { sessionKey, sourceRoot, onSession, prompt } = options;
    let session = store.data.agentSessions?.[sessionKey];
    if (session && (scopeKey(session.root) !== scopeKey(sourceRoot) || session.provider !== agentId)) session = null;
    if (!session) {
      session = { id: randomUUID(), provider: agentId, root: sourceRoot, createdAt: new Date().toISOString(), turns: 0 };
      await store.update(d => { d.agentSessions ||= {}; d.agentSessions[sessionKey] = session; });
    }
    const notice = await onSession?.(session);
    const cwd = path.join(store.directory, 'agent-sessions', session.id);
    await fs.mkdir(cwd, { recursive: true });
    try {
      const result = await runTurn({ ...options, prompt: prompt + (notice ? `\n${notice}` : ''), cwd, session: { id: session.id, resume: session.turns > 0 } });
      await store.update(d => { if (d.agentSessions?.[sessionKey]?.id === session.id) d.agentSessions[sessionKey].turns = session.turns + 1; });
      return result;
    } catch (error) {
      // A failed first turn may leave a half-created transcript. Start the next attempt with a fresh id.
      if (!session.turns) await store.update(d => { if (d.agentSessions?.[sessionKey]?.id === session.id) delete d.agentSessions[sessionKey]; }).catch(() => {});
      throw error;
    }
  }
  return { run, forget: () => {}, close: () => {} };
}
