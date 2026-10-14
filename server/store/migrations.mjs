// Upgrades reader.json in place on load. Each step is idempotent.
import { randomUUID } from 'node:crypto';
import { isQuestion } from '../domain/conversations.mjs';
import { provisionalTitle } from '../domain/chats.mjs';

export const DATA_VERSION = 2;
const REMOVED_AGENTS = ['gemini'];
export const emptyData = () => ({ version: DATA_VERSION, activeWorkspace: null, workspaces: [], notes: [], conversations: [], chats: [], sessions: {}, settings: {} });

export function migrate(data) {
  for (const [key, value] of Object.entries(emptyData())) if (data[key] === undefined) data[key] = structuredClone(value);
  // v1 → v2: one global model becomes per-agent models.
  if (data.settings.model !== undefined) { data.settings.models = { codex: data.settings.model, ...data.settings.models }; delete data.settings.model; }
  if (data.modelCatalog) { data.modelCatalogs = { codex: data.modelCatalog, ...data.modelCatalogs }; delete data.modelCatalog; }
  // v1 → v2: questions were one list per workspace. Keep them as a single legacy chat.
  if ((data.version || 1) < 2) {
    data.agentSessions = {};
    const byWorkspace = new Map();
    for (const c of data.conversations) if (!c.chatId && isQuestion(c)) { if (!byWorkspace.has(c.workspaceId)) byWorkspace.set(c.workspaceId, []); byWorkspace.get(c.workspaceId).push(c); }
    for (const [workspaceId, list] of byWorkspace) {
      const chat = { id: randomUUID(), workspaceId, title: `이전 기록 · ${provisionalTitle(list[0].question)}`, titleSource: 'auto', createdAt: list[0].createdAt || new Date().toISOString(), updatedAt: list.at(-1).createdAt || new Date().toISOString() };
      data.chats.push(chat);
      for (const c of list) c.chatId = chat.id;
    }
    const chatOf = new Map(data.conversations.map(c => [c.id, c.chatId]));
    for (const n of data.notes) if (n.sourceConversationId && !n.sourceChatId && chatOf.get(n.sourceConversationId)) n.sourceChatId = chatOf.get(n.sourceConversationId);
  }
  // Early refinements dropped a revision's links: restore the original question and the diagram record.
  const refined = new Set(data.conversations.filter(c => c.kind === 'refine').map(c => c.id));
  for (const n of data.notes) {
    if (!refined.has(n.generationId)) continue;
    const earlier = data.notes.filter(o => o.groupId === n.groupId && o.revision < n.revision).sort((a, b) => b.revision - a.revision);
    for (const field of ['sourceConversationId', 'sourceChatId']) if (!n[field]) { const from = earlier.find(o => o[field]); if (from) n[field] = from[field]; }
    if (n.diagrams?.length && !n.diagramRecordId) { const from = earlier.find(o => o.diagrams?.length && !refined.has(o.generationId)); if (from) n.diagramRecordId = from.diagramRecordId || from.generationId; }
  }
  // Removed agents fall back to the default agent; their saved model, catalog and sessions are dropped.
  for (const id of REMOVED_AGENTS) {
    if (data.settings.agent === id) delete data.settings.agent;
    if (data.settings.models) delete data.settings.models[id];
    if (data.modelCatalogs) delete data.modelCatalogs[id];
    for (const [key, session] of Object.entries(data.agentSessions || {})) if (session?.provider === id) delete data.agentSessions[key];
  }
  data.version = DATA_VERSION;
  return data;
}
