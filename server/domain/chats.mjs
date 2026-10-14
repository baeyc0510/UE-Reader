// Chats group question/answer records. Title lifecycle:
//   'auto'      provisional title from the first question
//   'generated' natural title returned by the agent for the first answer
//   'user'      renamed by the user; never overwritten
import { randomUUID } from 'node:crypto';
import { fail } from '../source/source.mjs';

export const TITLE_MAX = 80;
export function provisionalTitle(question = '') {
  const line = String(question).replace(/\s+/g, ' ').trim();
  return line ? (line.length > 36 ? `${line.slice(0, 35)}…` : line) : '새 채팅';
}
export function cleanTitle(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n]+/g, ' ').replace(/^["'「『]+|["'」』]+$/g, '').trim().slice(0, TITLE_MAX);
}

export const activeChats = (data, workspaceId) => data.chats.filter(c => c.workspaceId === workspaceId && !c.deletedAt);
export function findChat(data, id, { includeDeleted = false } = {}) {
  const chat = data.chats.find(c => c.id === id && (includeDeleted || !c.deletedAt));
  if (!chat) throw fail('채팅을 찾을 수 없습니다.', 404);
  return chat;
}

export function createChat(data, { workspaceId, question }) {
  const now = new Date().toISOString();
  const chat = { id: randomUUID(), workspaceId, title: provisionalTitle(question), titleSource: 'auto', createdAt: now, updatedAt: now };
  data.chats.push(chat);
  return chat;
}

// The first successful answer names the chat unless the user already renamed it.
export function applyAnswerTitle(chat, agentTitle) {
  chat.updatedAt = new Date().toISOString();
  if (chat.titleSource !== 'auto') return;
  const title = cleanTitle(agentTitle);
  if (title) { chat.title = title; chat.titleSource = 'generated'; }
}

export function summarizeChat(chat, conversations) {
  const own = conversations.filter(c => c.chatId === chat.id);
  return { id: chat.id, title: chat.title, titleSource: chat.titleSource, createdAt: chat.createdAt, updatedAt: chat.updatedAt, count: own.length, lastQuestion: own.at(-1)?.question || '' };
}
