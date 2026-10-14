import { useCallback, useEffect, useRef, useState } from 'react';
import { api, json } from '../api/client';
import type { Chat, Conversation } from '../types';

// Chat list of a workspace and the question/answer records of the active chat.
// activeChatId: undefined = not chosen yet (pick the latest), '' = new empty chat.
export function useChats(workspaceId: string, activeChatId: string | undefined, report: (e: unknown) => void) {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const current = useRef({ workspaceId, activeChatId }); current.current = { workspaceId, activeChatId };

  const refreshChats = useCallback(async () => {
    if (!workspaceId) return;
    const id = workspaceId, data = await api<Chat[]>(`/workspaces/${id}/chats`);
    if (current.current.workspaceId === id) setChats(data);
  }, [workspaceId]);
  const refreshConversations = useCallback(async () => {
    if (!workspaceId || activeChatId === undefined) return;
    if (!activeChatId) { setConversations([]); return; }
    const key = `${workspaceId}/${activeChatId}`;
    const data = await api<Conversation[]>(`/workspaces/${workspaceId}/conversations?chatId=${encodeURIComponent(activeChatId)}`);
    if (`${current.current.workspaceId}/${current.current.activeChatId}` === key) setConversations(data);
  }, [workspaceId, activeChatId]);

  useEffect(() => { setChats(null); refreshChats().catch(report); }, [refreshChats]);
  useEffect(() => { setConversations([]); refreshConversations().catch(report); }, [refreshConversations]);

  const rename = async (id: string, title: string) => { await api(`/chats/${id}`, json('PATCH', { title })); await refreshChats(); };
  const setDeleted = async (id: string, deleted: boolean) => { await api(`/chats/${id}`, json('PATCH', { deleted })); await refreshChats(); };
  return { chats, conversations, refreshChats, refreshConversations, rename, setDeleted };
}
