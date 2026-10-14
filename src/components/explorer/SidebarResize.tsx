import { useRef, useState } from 'react';

export function SidebarResize({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const bounded = (value: number) => Math.round(Math.max(180, Math.min(600, window.innerWidth * .45, value)));
  return <div className={`sidebar-resizer ${dragging ? 'dragging' : ''}`} role="separator" aria-label="탐색기 너비 조절" aria-orientation="vertical"
    aria-valuemin={180} aria-valuemax={600} aria-valuenow={Math.round(width)} tabIndex={0}
    onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onChange(bounded(width + (e.key === 'ArrowLeft' ? -16 : 16))); } }}
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, width: e.currentTarget.parentElement!.getBoundingClientRect().width }; setDragging(true);
    }}
    onPointerMove={e => { if (drag.current) onChange(bounded(drag.current.width + e.clientX - drag.current.x)); }}
    onPointerUp={e => { drag.current = null; setDragging(false); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
    onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
    onDoubleClick={() => onChange(244)} title="드래그하여 탐색기 너비 조절 · 두 번 클릭하여 기본 너비 복원"/>;
}
