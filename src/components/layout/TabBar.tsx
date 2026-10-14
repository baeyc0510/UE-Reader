import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftToLine, ArrowRightToLine, Copy, CopyX, FileCode2, FolderSearch, Star, X, XCircle } from 'lucide-react';
import { ContextMenu, type MenuItem } from '../common/ContextMenu';
import { IconButton } from '../common/IconButton';
import { basename } from '../../lib/format';

type Props = {
  tabs: string[]; active: string; favorites: string[]; leading?: ReactNode; trailing?: ReactNode;
  onOpen: (file: string) => void; onClose: (files: string[]) => void; onReorder: (tabs: string[]) => void;
  onCopy: (text: string, what: string) => void; onReveal: (file: string) => void; onToggleFavorite: (file: string) => void;
};

// Open files: click to switch, middle-click to close, drag to reorder, right-click for bulk actions.
export function TabBar({ tabs, active, favorites, leading, trailing, onOpen, onClose, onReorder, onCopy, onReveal, onToggleFavorite }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; file: string } | null>(null), [dragging, setDragging] = useState(''), [over, setOver] = useState('');
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { strip.current?.querySelector<HTMLElement>('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active, tabs.length]);
  const items = (file: string): MenuItem[] => {
    const i = tabs.indexOf(file), others = tabs.filter(t => t !== file);
    return [
      { label: '닫기', hint: 'Ctrl W', icon: <X size={13}/>, onSelect: () => onClose([file]) },
      { label: '다른 탭 모두 닫기', icon: <XCircle size={13}/>, disabled: !others.length, onSelect: () => onClose(others) },
      { label: '왼쪽 탭 닫기', icon: <ArrowLeftToLine size={13}/>, disabled: i <= 0, onSelect: () => onClose(tabs.slice(0, i)) },
      { label: '오른쪽 탭 닫기', icon: <ArrowRightToLine size={13}/>, disabled: i >= tabs.length - 1, onSelect: () => onClose(tabs.slice(i + 1)) },
      { label: '모든 탭 닫기', icon: <CopyX size={13}/>, onSelect: () => onClose(tabs) },
      { label: '경로 복사', icon: <Copy size={13}/>, divider: true, onSelect: () => onCopy(file, '경로') },
      { label: '파일 이름 복사', icon: <Copy size={13}/>, onSelect: () => onCopy(basename(file), '파일 이름') },
      { label: '탐색기에서 보기', icon: <FolderSearch size={13}/>, onSelect: () => onReveal(file) },
      { label: favorites.includes(file) ? '즐겨찾기 해제' : '즐겨찾기에 추가', icon: <Star size={13}/>, onSelect: () => onToggleFavorite(file) },
    ];
  };
  const drop = (target: string) => {
    if (!dragging || dragging === target) return;
    const next = tabs.filter(t => t !== dragging); next.splice(next.indexOf(target) + (tabs.indexOf(dragging) < tabs.indexOf(target) ? 1 : 0), 0, dragging);
    onReorder(next);
  };
  return <div className="tabbar">
    {leading}
    <div className="tabs" role="tablist" aria-label="열린 파일" ref={strip} onWheel={e => { if (strip.current && !e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY; }}>
      {tabs.map(f => <div key={f} className={`tab ${active === f ? 'active' : ''} ${dragging === f ? 'dragging' : ''} ${over === f && dragging !== f ? 'drop-target' : ''}`} draggable
        onMouseDown={e => { if (e.button === 1) e.preventDefault(); }}
        onAuxClick={e => { if (e.button === 1) { e.preventDefault(); onClose([f]); } }}
        onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, file: f }); }}
        onDragStart={e => { setDragging(f); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f); }}
        onDragOver={e => { if (dragging) { e.preventDefault(); setOver(f); } }} onDragLeave={() => setOver(o => o === f ? '' : o)}
        onDrop={e => { e.preventDefault(); drop(f); setOver(''); }} onDragEnd={() => { setDragging(''); setOver(''); }}>
        <button role="tab" aria-selected={active === f} onClick={() => onOpen(f)} title={`${f}\n휠 클릭: 닫기 · 우클릭: 탭 메뉴`}><FileCode2 size={14}/>{basename(f)}{favorites.includes(f) && <Star size={10} className="tab-favorite"/>}</button>
        <button aria-label={`${basename(f)} 탭 닫기`} onClick={() => onClose([f])}><X size={12}/></button>
      </div>)}
    </div>
    {tabs.length > 1 && <IconButton label="모든 탭 닫기" onClick={() => onClose(tabs)}><CopyX size={15}/></IconButton>}
    {trailing}
    {menu && <ContextMenu x={menu.x} y={menu.y} label="탭 메뉴" onClose={() => setMenu(null)} items={items(menu.file)}/>}
  </div>;
}
