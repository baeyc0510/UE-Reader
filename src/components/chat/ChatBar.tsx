import { useState } from 'react';
import { ChevronDown, Pencil, Plus } from 'lucide-react';
import { ChatList } from './ChatList';
import type { Chat } from '../../types';

type Props = { chats: Chat[]; activeId: string; disabled: boolean; onSelect: (id: string) => void; onNew: () => void; onRename: (id: string, title: string) => Promise<void>; onDelete: (chat: Chat) => void };

// Header of the question tab: current chat title (editable), chat history and a new-chat button.
export function ChatBar({ chats, activeId, disabled, onSelect, onNew, onRename, onDelete }: Props) {
  const [open, setOpen] = useState(false), [editing, setEditing] = useState<string | null>(null), [error, setError] = useState('');
  const chat = chats.find(c => c.id === activeId);
  async function commit() {
    if (editing === null || !chat) return;
    const value = editing.trim();
    if (!value || value === chat.title) { setEditing(null); return; }
    try { await onRename(chat.id, value); setEditing(null); setError(''); } catch (e) { setError((e as Error).message); }
  }
  return <div className="chat-header">
    <div className="chat-bar">
      <button className="chat-switch" aria-expanded={open} aria-label="채팅 목록" title="채팅 목록 · 우클릭으로 이름 편집과 삭제" onClick={() => setOpen(v => !v)}><ChevronDown size={14} className={open ? 'flipped' : ''}/><span className="chat-count">{chats.length}</span></button>
      {editing !== null ? <input className="chat-title-input" autoFocus aria-label="현재 채팅 이름" maxLength={80} value={editing} onChange={e => setEditing(e.target.value)} onBlur={() => void commit()}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void commit(); } if (e.key === 'Escape') { e.preventDefault(); setEditing(null); } }}/>
        : <strong className="chat-title" title={chat?.title} onDoubleClick={() => chat && setEditing(chat.title)}>{chat?.title || '새 채팅'}</strong>}
      {chat && editing === null && <button className="icon-button" aria-label="채팅 이름 편집" title="채팅 이름 편집" onClick={() => setEditing(chat.title)}><Pencil size={13}/></button>}
      <button className="new-chat" disabled={disabled || !activeId} onClick={() => { onNew(); setOpen(false); }}><Plus size={13}/>새 채팅</button>
    </div>
    {error && <p className="model-warning" role="alert">{error}</p>}
    {open && <ChatList chats={chats} activeId={activeId} onSelect={id => { onSelect(id); setOpen(false); }} onRename={onRename} onDelete={onDelete}/>}
  </div>;
}
