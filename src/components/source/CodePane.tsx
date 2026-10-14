import { forwardRef, useImperativeHandle, useMemo, useRef, useState, useLayoutEffect, useEffect } from 'react';
import { readingInset } from '../../lib/scroll';
import type { Context, Note, Source } from '../../types';
export type CodeTarget = { x: number; y: number; line: number; word: string; scope: string; member: boolean; selection: string };
export type CodeHandle = { go: (line: number) => void; flash: (line: number) => void; reveal: (start: number, end: number) => void; restore: (top: number) => void; top: () => number };
type Props = { fontFamily: string; source: Source; fontSize: number; wrap: boolean; contexts: Context[]; activeNote?: Note; preview?: Context | null; find: string; onScroll: (line: number, top: number, user: boolean) => void; onSelect: (start: number, end: number, shift: boolean, toggle?: boolean) => void; onPreviewSelection: (range: Context | null, reveal: boolean) => void; onContextMenu?: (target: CodeTarget) => void };
export const CodePane = forwardRef<CodeHandle, Props>(function CodePane({ fontFamily, source, fontSize, wrap, contexts, activeNote, preview, find, onScroll, onSelect, onPreviewSelection, onContextMenu }, ref) {
  const viewport = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0), [size, setSize] = useState({ width: 600, height: 700 });
  const autoUntil = useRef(0);
  const drag = useRef<{ anchor: number; end: number; y: number; shift: boolean; moved: boolean } | null>(null);
  const [dragRange, setDragRange] = useState<Context | null>(null);
  // Briefly blinks a navigation target (go to definition, search result) so the eye finds it.
  const [flash, setFlash] = useState<{ line: number; serial: number } | null>(null);
  useEffect(() => { if (!flash) return; const timer = setTimeout(() => setFlash(null), 1600); return () => clearTimeout(timer); }, [flash]);
  const [syntax, setSyntax] = useState<{ text: string; lines: string[] } | null>(null);
  useEffect(() => {
    const worker = new Worker(new URL('./syntax.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = e => setSyntax({ text: source.text, lines: e.data });
    worker.postMessage(source.text);
    return () => worker.terminate();
  }, [source.text]);
  const lines = useMemo(() => source.text.split('\n'), [source.text]);
  const lineHeight = Math.round(fontSize * 1.85);
  const charWidth = useMemo(() => {
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    if (!context) return fontSize * .603;
    context.font = `${fontSize}px ${fontFamily}`;
    return context.measureText('0000000000').width / 10 || fontSize * .603;
  }, [fontSize, fontFamily]);
  const offsets = useMemo(() => {
    const chars = Math.max(12, Math.floor((size.width - 90) / charWidth));
    let y = 20;
    return lines.map(line => { const start = y; y += lineHeight * (wrap ? Math.max(1, Math.ceil(line.replace(/\t/g, '    ').length / chars)) : 1); return start; }).concat(y + size.height - readingInset(size.height));
  }, [lines, wrap, size.width, size.height, charWidth, lineHeight]);
  function lineAt(y: number) { let low = 0, high = lines.length - 1; while (low < high) { const middle = Math.ceil((low + high) / 2); if (offsets[middle] > y) high = middle - 1; else low = middle; } return low; }
  function extendDrag(y: number) {
    const d = drag.current, el = viewport.current; if (!d || !el) return;
    d.y = y;
    const end = lineAt(y - el.getBoundingClientRect().top + el.scrollTop) + 1;
    if (end === d.end) return;
    d.end = end; d.moved = true;
    const range = { path: source.path, start: Math.min(d.anchor, end), end: Math.max(d.anchor, end) };
    setDragRange(range); onPreviewSelection(range, false);
  }
  // Continue selecting when the pointer reaches the viewport edge.
  const extendRef = useRef(extendDrag); extendRef.current = extendDrag;
  useEffect(() => {
    if (!dragRange) return;
    let frame: number;
    const tick = () => {
      const d = drag.current, el = viewport.current;
      if (!d || !el) return;
      const rect = el.getBoundingClientRect();
      const distance = d.y < rect.top + 28 ? d.y - rect.top - 28 : d.y > rect.bottom - 28 ? d.y - rect.bottom + 28 : 0;
      if (distance) { el.scrollTop += Math.sign(distance) * Math.min(24, Math.max(3, Math.abs(distance) / 3)); extendRef.current(d.y); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [!!dragRange]);
  useImperativeHandle(ref, () => ({
    reveal(start) { const el = viewport.current; if (el) { autoUntil.current = Date.now() + 180; el.scrollTop = Math.max(0, offsets[Math.max(0, Math.min(lines.length - 1, start - 1))] - readingInset(size.height)); } },
    go(line) { if (viewport.current) { autoUntil.current = Date.now() + 180; viewport.current.scrollTop = Math.max(0, offsets[Math.max(0, Math.min(lines.length - 1, line - 1))] - readingInset(size.height)); } },
    restore(y) { if (viewport.current) { autoUntil.current = Date.now() + 180; viewport.current.scrollTop = y; setTop(y); onScroll(lineAt(viewport.current.scrollTop + readingInset(size.height)) + 1, viewport.current.scrollTop, false); } },
    top() { return viewport.current?.scrollTop || 0; },
    flash(line) { setFlash(f => ({ line, serial: (f?.serial || 0) + 1 })); }
  }));
  useLayoutEffect(() => { const el = viewport.current!; const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight })); observer.observe(el); return () => observer.disconnect(); }, []);
  const first = Math.max(0, lineAt(top) - 12), last = Math.min(lines.length, lineAt(top + size.height) + 16);
  const escaped = (line: string) => line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const rendered = syntax?.text === source.text ? syntax.lines.slice(first, last) : lines.slice(first, last).map(escaped);
  // Identifier under the pointer (and its `Owner::` qualifier) for the IDE-style context menu.
  function targetAt(e: React.MouseEvent): CodeTarget {
    const row = (e.target as HTMLElement).closest('[data-line]'), line = Number(row?.getAttribute('data-line')) || 0, code = row?.querySelector('code');
    const text = lines[line - 1] ?? '', selected = window.getSelection();
    const selection = selected && !selected.isCollapsed && viewport.current?.contains(selected.anchorNode) ? selected.toString() : '';
    let column = -1;
    const caret = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (caret && code?.contains(caret.startContainer)) { const range = document.createRange(); range.setStart(code, 0); range.setEnd(caret.startContainer, caret.startOffset); column = range.toString().length; }
    else if (code) {
      // Pointer on padding or between glyphs: map the x offset through the monospace grid.
      const style = getComputedStyle(code), tab = Number(style.tabSize) || 8;
      const visual = Math.floor((e.clientX - code.getBoundingClientRect().left - (parseFloat(style.paddingLeft) || 0)) / charWidth);
      for (let i = 0, x = 0; i < text.length; i++) { x += text[i] === '\t' ? tab - (x % tab) : 1; if (x > visual) { column = i; break; } }
    }
    let from = column, to = column;
    if (column >= 0) { while (from > 0 && /\w/.test(text[from - 1])) from--; while (to < text.length && /\w/.test(text[to])) to++; }
    const picked = /^[A-Za-z_]\w*$/.test(selection.trim()) ? selection.trim() : text.slice(from, to);
    const word = /^[A-Za-z_]\w*$/.test(picked) ? picked : '';
    const scope = word && picked !== selection.trim() ? /([A-Za-z_]\w*)\s*::\s*~?$/.exec(text.slice(0, from))?.[1] || '' : '';
    const member = !!word && !scope && /(?:\.|->)\s*$/.test(text.slice(0, from));
    return { x: e.clientX, y: e.clientY, line, word, scope, member, selection };
  }
  return <div className={`code-viewport ${dragRange ? 'selecting-lines' : ''}`} ref={viewport} tabIndex={0} aria-label="읽기 전용 소스 코드" onWheel={() => { autoUntil.current = 0; }} onPointerDown={() => { autoUntil.current = 0; }} onMouseUp={e => {
      // Text selection in code highlights the matching explanation without attaching lines.
      // Gutter gestures prevent default on pointerdown, so no mouseup reaches here for them.
      if (e.button !== 0) return;
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed || !viewport.current?.contains(selected.anchorNode) || !viewport.current?.contains(selected.focusNode)) return;
      const lineOf = (node: Node | null) => Number((node instanceof Element ? node : node?.parentElement)?.closest('[data-line]')?.getAttribute('data-line'));
      const a = lineOf(selected.anchorNode), b = lineOf(selected.focusNode);
      if (a && b) onPreviewSelection({ path: source.path, start: Math.min(a, b), end: Math.max(a, b) }, true);
    }} onContextMenu={e => { if (!onContextMenu || (e.target as HTMLElement).closest('.line-number')) return; e.preventDefault(); onContextMenu(targetAt(e)); }}
    onPointerMove={e => extendDrag(e.clientY)}
    onPointerUp={e => {
      const d = drag.current; if (!d) return;
      extendDrag(e.clientY); drag.current = null; setDragRange(null);
      onSelect(Math.min(d.anchor, d.end), Math.max(d.anchor, d.end), d.shift, !d.moved);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    }}
    onLostPointerCapture={() => { if (drag.current) { drag.current = null; setDragRange(null); onPreviewSelection(null, false); } }}
    onScroll={e => { const el = e.currentTarget; setTop(el.scrollTop); onScroll(lineAt(el.scrollTop + readingInset(size.height)) + 1, el.scrollTop, !drag.current && Date.now() > autoUntil.current); }} style={{ fontSize, lineHeight: `${lineHeight}px` }}>
    <div className="code-lines" style={{ height: offsets[offsets.length - 1], minWidth: wrap ? 0 : 'max-content' }}>
      {lines.slice(first, last).map((line, index) => {
        const i = index + first, n = i + 1;
        const selected = dragRange ? n >= dragRange.start && n <= dragRange.end : contexts.some(c => c.path === source.path && n >= c.start && n <= c.end);
        const related = activeNote && !activeNote.overview && activeNote.sourceState !== 'changed' && activeNote.sourceState !== 'missing' && n >= activeNote.start && n <= activeNote.end;
        const sentence = preview?.path === source.path && n >= preview.start && n <= preview.end;
        return <div data-line={n} key={n} className={`code-line ${selected ? 'selected' : ''} ${related ? 'related' : ''} ${sentence ? 'sentence-highlight' : ''} ${flash?.line === n ? `flash-line flash-${flash.serial % 2}` : ''} ${find && line.toLowerCase().includes(find.toLowerCase()) ? 'match' : ''}`} style={{ top: offsets[i], height: i === lines.length - 1 ? lineHeight : offsets[i + 1] - offsets[i], ...(wrap ? { width: '100%' } : { minWidth: '100%' }) }}>
          <button className="line-number" tabIndex={-1} aria-label={`${n}행 선택`} aria-pressed={selected}
            onPointerDown={e => {
              if (e.button !== 0) return;
              e.preventDefault(); window.getSelection()?.removeAllRanges();
              viewport.current!.setPointerCapture(e.pointerId);
              drag.current = { anchor: n, end: n, y: e.clientY, shift: e.shiftKey, moved: false };
              setDragRange({ path: source.path, start: n, end: n });
            }}
            onClick={e => { if (e.detail === 0) onSelect(n, n, e.shiftKey, true); }}>{n}</button>
          <code style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre', overflowWrap: wrap ? 'anywhere' : undefined }} dangerouslySetInnerHTML={{ __html: rendered[index] || ' ' }} />
        </div>;
      })}
    </div>
  </div>;
});
