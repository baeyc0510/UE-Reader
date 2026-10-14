// A conversation record is one request/response. Questions belong to a chat (chatId);
// overview/explain/answer-explain records only produce notes.
export const isQuestion = c => c.kind ? c.kind === 'question' : !['파일 개요 생성', '선택 코드 해설'].includes(c.question);

// Explanation links shown under an answer: the first selected note per file generated from it.
export function withExplanations(conversation, notes) {
  const paths = new Map();
  for (const n of notes) {
    if (n.sourceConversationId !== conversation.id || !n.selected || n.deletedAt) continue;
    const old = paths.get(n.path);
    if (!old || n.start < old.start) paths.set(n.path, { path: n.path, start: n.start, id: n.id });
  }
  return { ...conversation, explanations: [...paths.values()] };
}

// Prior completed questions of the same chat, oldest first, for stateless agents.
export function chatHistory(conversations, chatId, count) {
  if (!chatId || count <= 0) return [];
  return conversations.filter(c => c.chatId === chatId && c.status === 'complete' && isQuestion(c)).slice(-count).map(c => ({
    question: c.question, answer: c.answer,
    ...(!c.kind && c.sections?.length ? { legacyExplanations: c.sections.map(({ title, body }) => ({ title, body })) } : {}),
    inspectedFiles: (c.context || []).map(ctx => ctx.path), suggestedFiles: c.suggestedFiles || [],
  }));
}
