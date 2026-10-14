import { useState } from 'react';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { ContextMenu } from '../common/ContextMenu';
import { date } from '../../lib/format';
import type { Chat } from '../../types';

type Props = { chats: Chat[]; activeId: string; onSelect: (id: string) => void; onRename: (id: string, title: string) => Promise<void>; onDelete: (chat: Chat) => void };

// Chat history. Right-click (or Shift+F10 / context-menu key) opens rename and delete.
export function ChatList({ chats, activeId, onSelect, onRename, onDelete }: Props) {
  const [menu, setMenu] = useState<{ chat: Chat; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string; error: string } | null>(null);
  async function commit() {
    if (!editing) return;
    const value = editing.value.trim(), chat = chats.find(c => c.id === editing.id);
    if (!value || value === chat?.title) { setEditing(null); return; }
    try { await onRename(editing.id, value); setEditing(null); } catch (e) { setEditing({ ...editing, error: (e as Error).message }); }
  }
  if (!chats.length) return <div className="chat-list"><p className="small-empty">아직 채팅이 없습니다. 질문을 보내면 새 채팅이 만들어집니다.</p></div>;
  return <div className="chat-list" role="list" aria-label="채팅 목록">
    {chats.map(chat => editing?.id === chat.id ? <div key={chat.id} role="listitem" className="chat-item editing">
      <input autoFocus aria-label="채팅 이름" maxLength={80} value={editing.value} onChange={e => setEditing({ ...editing, value: e.target.value, error: '' })}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void commit(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null); } }} onBlur={() => void commit()}/>
      {editing.error && <small role="alert">{editing.error}</small>}
    </div> : <div key={chat.id} role="listitem" className={`chat-item ${chat.id === activeId ? 'active' : ''}`}>
      <button aria-current={chat.id === activeId ? 'true' : undefined} title={chat.lastQuestion || chat.title} onClick={() => onSelect(chat.id)}
        onContextMenu={e => { e.preventDefault(); setMenu({ chat, x: e.clientX, y: e.clientY }); }}
        onKeyDown={e => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ chat, x: r.left + 24, y: r.bottom }); } }}>
        <MessageSquare size={14}/><span><strong>{chat.title}</strong><small>{date(chat.updatedAt)} · 질문 {chat.count}개</small></span>
      </button>
    </div>)}
    {menu && <ContextMenu x={menu.x} y={menu.y} label={`${menu.chat.title} 메뉴`} onClose={() => setMenu(null)} items={[
      { label: '이름 편집', icon: <Pencil size={13}/>, onSelect: () => setEditing({ id: menu.chat.id, value: menu.chat.title, error: '' }) },
      { label: '삭제', icon: <Trash2 size={13}/>, danger: true, onSelect: () => onDelete(menu.chat) },
    ]}/>}
  </div>;
}
