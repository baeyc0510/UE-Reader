// Agent registry: the only place that knows which CLIs exist.
// Agent contract (see AGENTS.md "에이전트 추가"):
//   { id, label, loginHint, supportsUsage,
//     status(), run(options), sessions: { run(options), forget(key), close() },
//     listModels(), version(), usage?(force), catalog (added here) }
import { fail } from '../source/source.mjs';
import { createModelCatalog } from './model-catalog.mjs';
import { createCodexAgent } from './codex/index.mjs';
import { createClaudeAgent } from './claude/index.mjs';

export const DEFAULT_AGENT = 'codex';
const factories = { codex: createCodexAgent, claude: createClaudeAgent };
export const AGENT_IDS = Object.keys(factories);

/** overrides: { codex: {...}, claude: {...} } replaces CLI calls in tests. */
export function createAgents({ store, dataDir, overrides = {} }) {
  const agents = new Map(AGENT_IDS.map(id => {
    const agent = factories[id]({ store, dataDir, overrides: overrides[id] || {} });
    agent.catalog = createModelCatalog({ store, agent, provider: agent.listModels, versionProvider: agent.version });
    return [id, agent];
  }));
  const get = id => { const agent = agents.get(id); if (!agent) throw fail('지원하지 않는 에이전트입니다.'); return agent; };
  return {
    get,
    has: id => agents.has(id),
    describe: () => [...agents.values()].map(({ id, label, loginHint, supportsUsage }) => ({ id, label, loginHint, supportsUsage })),
    async usage(id, force) {
      const agent = get(id);
      if (!agent.supportsUsage) return { buckets: [], fetchedAt: null, stale: false, unsupported: true, warning: `${agent.label}는 남은 사용량 조회를 지원하지 않습니다.` };
      return agent.usage(force);
    },
    // Retained conversations are keyed by chat id. Forget every agent's worker for that chat.
    async resetSession(key) {
      for (const agent of agents.values()) agent.sessions.forget?.(key);
      await store.update(d => { if (d.agentSessions) delete d.agentSessions[key]; });
    },
    async resetAllSessions() {
      for (const agent of agents.values()) agent.sessions.close?.();
      await store.update(d => { d.agentSessions = {}; });
    },
    close() { for (const agent of agents.values()) agent.sessions.close?.(); },
  };
}
