// Chats (per-topic question history) and their question/answer records.
import { asyncRoute } from '../http/security.mjs';
import { fail } from '../source/source.mjs';
import { activeChats, findChat, summarizeChat, cleanTitle } from '../domain/chats.mjs';
import { isQuestion, withExplanations } from '../domain/conversations.mjs';

export function chatRoutes(app, { store, agents, workspace, runningJobs }) {
  app.get('/api/workspaces/:id/chats', asyncRoute(async (req, res) => {
    workspace(req.params.id);
    res.json(activeChats(store.data, req.params.id).map(c => summarizeChat(c, store.data.conversations)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }));
  // ?chatId= limits to one chat; without it every question of the workspace (oldest first).
  app.get('/api/workspaces/:id/conversations', asyncRoute(async (req, res) => {
    workspace(req.params.id);
    const chatId = req.query.chatId ? String(req.query.chatId) : null;
    const hidden = new Set(store.data.chats.filter(c => c.deletedAt).map(c => c.id));
    res.json(store.data.conversations.filter(c => c.workspaceId === req.params.id && isQuestion(c) && (chatId ? c.chatId === chatId : !hidden.has(c.chatId))).map(c => withExplanations(c, store.data.notes)));
  }));
  // body: { title } renames (marks the title as user-owned); { deleted } soft-deletes or restores.
  app.patch('/api/chats/:id', asyncRoute(async (req, res) => {
    const { title, deleted } = req.body;
    if (title !== undefined && !cleanTitle(title)) throw fail('채팅 이름을 입력하세요.');
    if (deleted === true && runningJobs().some(j => j.chatId === req.params.id)) throw fail('진행 중인 답변이 있는 채팅은 삭제할 수 없습니다. 먼저 요청을 취소하세요.', 409);
    const chat = await store.update(d => {
      const chat = findChat(d, req.params.id, { includeDeleted: true });
      if (title !== undefined) { chat.title = cleanTitle(title); chat.titleSource = 'user'; }
      if (typeof deleted === 'boolean') chat.deletedAt = deleted ? new Date().toISOString() : null;
      return chat;
    });
    if (deleted === true) await agents.resetSession(chat.id);
    res.json(summarizeChat(chat, store.data.conversations));
  }));
  app.post('/api/chats/:id/agent-session/reset', asyncRoute(async (req, res) => {
    findChat(store.data, req.params.id);
    if (runningJobs().some(j => j.chatId === req.params.id)) throw fail('진행 중인 요청을 완료하거나 취소한 뒤 세션을 새로 시작하세요.', 409);
    await agents.resetSession(req.params.id); res.json({ ok: true });
  }));
  app.post('/api/conversations/:id/promote', () => { throw fail('답변의 코드 해설 생성 버튼에서 별도 해설을 요청하세요.', 410); });
}
