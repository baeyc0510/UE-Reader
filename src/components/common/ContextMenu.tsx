import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; divider?: boolean; hint?: string; onSelect: () => void };

// Floating menu at a pointer position. Closes on Escape, outside click, scroll or resize.
// Arrow keys move between items; the first item is focused when opened.
export function ContextMenu({ x, y, items, label, onClose }: { x: number; y: number; items: MenuItem[]; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current!; const rect = el.getBoundingClientRect();
    setPosition({ left: Math.max(4, Math.min(x, innerWidth - rect.width - 4)), top: Math.max(4, Math.min(y, innerHeight - rect.height - 4)) });
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);
  useEffect(() => {
    const close = (e: Event) => { if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('pointerdown', close, true); window.addEventListener('keydown', key); window.addEventListener('resize', onClose); window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', key); window.removeEventListener('resize', onClose); window.removeEventListener('scroll', close, true); };
  }, [onClose]);
  const move = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return <div ref={ref} className="context-menu" role="menu" aria-label={label} style={position} onKeyDown={move} onContextMenu={e => e.preventDefault()}>
    {items.map(item => <button key={item.label} role="menuitem" disabled={item.disabled} className={`${item.danger ? 'danger' : ''} ${item.divider ? 'divider' : ''}`} onClick={() => { onClose(); item.onSelect(); }}>{item.icon}{item.label}{item.hint && <kbd>{item.hint}</kbd>}</button>)}
  </div>;
}
