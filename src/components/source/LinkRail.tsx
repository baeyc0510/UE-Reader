import type { RefObject } from 'react';
import { Link2, Link2Off } from 'lucide-react';

// Divider between code and explanation: width resizing and the scroll-link toggle.
export function LinkRail({ split, linked, containerRef, onSplit, onToggle }: { split: number; linked: boolean; containerRef: RefObject<HTMLDivElement>; onSplit: (split: number) => void; onToggle: () => void }) {
  const clamp = (value: number) => Math.max(30, Math.min(72, value));
  return <div className="link-rail">
    <div className="resize-handle" role="separator" aria-label="코드와 해설 너비 조절" aria-orientation="vertical" aria-valuenow={split} tabIndex={0}
      onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onSplit(clamp(split + (e.key === 'ArrowLeft' ? -2 : 2))); } }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const rect = containerRef.current!.getBoundingClientRect(); onSplit(clamp((e.clientX - rect.left) / rect.width * 100)); }}
      onPointerUp={e => e.currentTarget.releasePointerCapture(e.pointerId)}><span/></div>
    <button className={`link-toggle ${linked ? 'on' : ''}`} onClick={onToggle} title="양방향 스크롤 연결 (Ctrl Shift L)" aria-label="양방향 스크롤 연결 (Ctrl Shift L)" aria-pressed={linked}>{linked ? <Link2 size={17}/> : <Link2Off size={17}/>}<b>{linked ? 'ON' : 'OFF'}</b></button>
    <span className="rail-caption">SCROLL LINK</span>
  </div>;
}
