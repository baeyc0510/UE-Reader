import { useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, GitBranch, Minus, Plus } from 'lucide-react';
import { Markdown } from '../common/Markdown';
import { api, json } from '../../api/client';
import { basename } from '../../lib/format';
import type { AnalysisDiagram, Context } from '../../types';

const names = { 'call-chain': '호출 흐름', lifecycle: '라이프사이클', 'data-flow': '데이터 흐름' };
const edgeNames = { call: '호출', transition: '전이', data: '데이터 전달', conditional: '조건' };
type Props = { diagrams?: AnalysisDiagram[]; workspaceId: string; recordId: string; noteId?: string; navigate: (path: string, line?: number) => void };

// Layer DAGs by dependency. Remaining cycle nodes retain their supplied order.
function positions(diagram: AnalysisDiagram) {
  const rank = new Map<string, number>(), pending = new Set(diagram.nodes.map(n => n.id));
  for (let pass = 0; pass < diagram.nodes.length && pending.size; pass++) {
    let progressed = false;
    for (const node of diagram.nodes) {
      if (!pending.has(node.id)) continue;
      const parents = diagram.edges.filter(e => e.to === node.id && e.from !== node.id).map(e => e.from);
      if (parents.some(id => pending.has(id))) continue;
      rank.set(node.id, parents.length ? Math.max(...parents.map(id => rank.get(id) || 0)) + 1 : 0);
      pending.delete(node.id); progressed = true;
    }
    if (!progressed) {
      const id = pending.values().next().value!;
      rank.set(id, rank.size ? Math.max(...rank.values()) + 1 : 0); pending.delete(id);
    }
  }
  const rows = new Map<number, number>();
  const result = new Map<string, { x: number; y: number }>();
  for (const node of diagram.nodes) {
    const row = rank.get(node.id) || 0, col = rows.get(row) || 0;
    rows.set(row, col + 1); result.set(node.id, { x: 34 + col * 260, y: 24 + row * 144 });
  }
  return { result, width: Math.max(320, ...[...rows.values()].map(n => n * 260 + 48)), height: Math.max(144, ...[...rank.values()].map(n => n * 144 + 132)) };
}

function Diagram({ diagram, workspaceId, recordId, noteId, navigate }: Omit<Props, 'diagrams'> & { diagram: AnalysisDiagram }) {
  const marker = useId().replaceAll(':', ''), detailId = `${marker}-detail`;
  const [selected, setSelected] = useState(diagram.nodes[0]?.id), [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState(''), [loading, setLoading] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null), graphRef = useRef<HTMLDivElement>(null);
  const clickSerial = useRef(0);
  const layout = useMemo(() => positions(diagram), [diagram]);
  const node = diagram.nodes.find(n => n.id === selected) || diagram.nodes[0];
  const select = (id: string) => {
    clickSerial.current++; setSelected(id); setStatus(''); setLoading(false);
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'nearest' }));
  };
  async function openReference(index: number) {
    const serial = ++clickSerial.current;
    setStatus(''); setLoading(true);
    try {
      const ref = await api<Context & { sourceState: string }>(`/workspaces/${workspaceId}/diagram-reference`, json('POST', { recordId, noteId, diagramId: diagram.id, nodeId: node.id, referenceIndex: index }));
      if (clickSerial.current !== serial) return;
      navigate(ref.path, ref.start);
      if (ref.sourceState === 'moved') setStatus('동일한 코드의 새 위치로 이동했습니다.');
    } catch (e) { if (clickSerial.current === serial) setStatus((e as Error).message); }
    finally { if (clickSerial.current === serial) setLoading(false); }
  }
  if (!node) return null;
  return <details className="analysis-diagram" open>
    <summary><GitBranch size={15}/><strong>{diagram.title}</strong><span>{names[diagram.kind]}</span><ChevronDown size={14}/></summary>
    <div className="diagram-toolbar"><small>단계 선택 → 해설</small><button onClick={() => setZoom(Math.min(1, Math.max(.5, (graphRef.current?.clientWidth || layout.width) / layout.width)))}>너비 맞춤</button><button aria-label="흐름도 축소" onClick={() => setZoom(v => Math.max(.5, v - .1))}><Minus size={13}/></button><button aria-label="흐름도 크기 복원" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button aria-label="흐름도 확대" onClick={() => setZoom(v => Math.min(1.5, v + .1))}><Plus size={13}/></button></div>
    <div className="diagram-scroll" ref={graphRef} aria-label={`${diagram.title} 흐름도`} onScroll={e => e.stopPropagation()}>
      <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
        <div className="diagram-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
          <svg width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="currentColor"/></marker></defs>
            {diagram.edges.map((edge, i) => {
              const a = layout.result.get(edge.from)!, b = layout.result.get(edge.to)!;
              if (!a || !b) return null;
              const forward = b.y > a.y, x1 = a.x + 116, y1 = a.y + 76, x2 = b.x + 116, y2 = b.y;
              const lane = Math.max(a.x, b.x) + 247;
              const d = forward ? `M${x1},${y1} C${x1},${y1 + 34} ${x2},${y2 - 34} ${x2},${y2 - 5}` : `M${a.x + 232},${a.y + 46} C${lane + 15},${a.y + 46} ${lane + 15},${b.y + 20} ${b.x + 237},${b.y + 20}`;
              return <g key={i} className={edge.kind === 'conditional' ? 'conditional-edge' : ''}><path d={d} fill="none" markerEnd={`url(#${marker})`}/><text x={forward ? (x1 + x2) / 2 : lane} y={forward ? (y1 + y2) / 2 - 4 : (a.y + b.y) / 2} textAnchor={forward ? 'middle' : 'end'}>{(edge.label || edgeNames[edge.kind]).slice(0, 24)}</text></g>;
            })}
          </svg>
          {diagram.nodes.map(n => { const pos = layout.result.get(n.id)!; return <button key={n.id} className={`diagram-node ${node.id === n.id ? 'selected' : ''}`} style={{ left: pos.x, top: pos.y }} aria-pressed={node.id === n.id} aria-controls={detailId} onClick={() => select(n.id)} title={n.label}><strong>{n.label}</strong><small>{n.references.length ? `${n.references.length}개 코드 근거` : '개념 설명 · 코드 연결 없음'}</small></button>; })}
        </div>
      </div>
    </div>
    <div className="diagram-detail" ref={detailRef} id={detailId} aria-live="polite"><h4>{node.label}</h4><Markdown text={node.explanation} navigate={navigate}/>
      <div className="diagram-references">{node.references.map((ref, i) => <button disabled={loading} key={i} title={ref.path} onClick={() => openReference(i)}>{basename(ref.path)} L{ref.start}–{ref.end}<ArrowUpRight size={12}/></button>)}</div>
      {!node.references.length && <small>검증된 코드 위치가 없는 단계입니다.</small>}
      {status && <p className="diagram-status" role="status">{status}</p>}
      <div className="diagram-neighbors">{diagram.edges.filter(e => e.from === node.id).map((e, i) => <button key={i} onClick={() => select(e.to)}>{e.label || edgeNames[e.kind]} → {diagram.nodes.find(n => n.id === e.to)?.label}</button>)}</div>
    </div>
    <details className="diagram-relationships"><summary>전체 관계 목록</summary>{diagram.edges.map((e, i) => <div key={i}><button onClick={() => select(e.from)}>{diagram.nodes.find(n => n.id === e.from)?.label}</button><span> → {e.label || edgeNames[e.kind]} → </span><button onClick={() => select(e.to)}>{diagram.nodes.find(n => n.id === e.to)?.label}</button></div>)}</details>
  </details>;
}

export function AnalysisDiagrams({ diagrams, ...props }: Props) {
  return <>{diagrams?.map(diagram => <Diagram key={`${props.recordId}/${diagram.id}`} diagram={diagram} {...props}/>)}</>;
}
