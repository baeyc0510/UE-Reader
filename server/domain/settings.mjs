// Global preferences in store.data.settings:
//   agent, models{[agentId]: modelId|null}, retainSession, historyCount, instructionPrompt, appearance,
//   extendedThinking (research agent before requests, review pass for explanations; absent = off),
//   rolePrompt, researchRolePrompt (agent role texts; empty = prompts.mjs defaults)
import { DEFAULT_AGENT } from '../agents/registry.mjs';

export const extendedThinking = store => store.data.settings?.extendedThinking === true;

export const conversationSettings = store => ({ retainSession: store.data.settings?.retainSession === true, historyCount: store.data.settings?.historyCount ?? 6 });
export const selectedAgent = store => store.data.settings?.agent || DEFAULT_AGENT;
export function selectedModel(store, agentId = selectedAgent(store)) {
  const models = store.data.settings?.models;
  if (models && models[agentId] !== undefined) return models[agentId];
  return agentId === 'codex' ? process.env.CODEX_MODEL || null : null;
}
export const instructionPrompt = store => store.data.settings?.instructionPrompt || '';
export const rolePrompts = store => ({ role: store.data.settings?.rolePrompt || '', researchRole: store.data.settings?.researchRolePrompt || '' });

// Settings as the client sees them. `model` is the selected agent's model for older clients.
export const publicSettings = store => ({ ...store.data.settings, ...conversationSettings(store), agent: selectedAgent(store), models: store.data.settings?.models || {}, model: selectedModel(store), extendedThinking: extendedThinking(store) });
