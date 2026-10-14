import { inspectedRanges } from '../source/inspected-ranges.mjs';

const reference = { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' } }, required: ['path', 'start', 'end'] };
export const diagramsSchema = { type: 'array', items: {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string' }, title: { type: 'string' }, kind: { type: 'string', enum: ['call-chain', 'lifecycle', 'data-flow'] },
    nodes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string' }, label: { type: 'string' }, explanation: { type: 'string' }, references: { type: 'array', items: reference },
    }, required: ['id', 'label', 'explanation', 'references'] } },
    edges: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string', enum: ['call', 'transition', 'data', 'conditional'] },
    }, required: ['from', 'to', 'label', 'kind'] } },
  }, required: ['id', 'title', 'kind', 'nodes', 'edges'],
} };

// Links are grounded in actual reads. An invalid diagram never discards a useful answer.
export function normalizeDiagrams(value, context, warnings = []) {
  const inspected = inspectedRanges(context).find;
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).flatMap((diagram, index) => {
    if (!diagram || typeof diagram.title !== 'string' || !Array.isArray(diagram.nodes)) return [];
    const ids = new Set();
    const nodes = diagram.nodes.slice(0, 30).flatMap(node => {
      if (!node || typeof node.id !== 'string' || !node.id || ids.has(node.id) || typeof node.label !== 'string' || !node.label.trim() || typeof node.explanation !== 'string') return [];
      ids.add(node.id);
      const references = (Array.isArray(node.references) ? node.references : []).slice(0, 6).flatMap(ref => {
        const source = inspected(ref);
        if (!source) { warnings.push(`시각화 코드 연결 제외 · ${node.label}: 확인하지 않은 파일 또는 라인입니다.`); return []; }
        return [{ path: source.path, start: ref.start, end: ref.end, hash: source.hash, snapshot: source.text.split('\n').slice(ref.start - source.start, ref.end - source.start + 1).join('\n') }];
      });
      return [{ id: node.id, label: node.label, explanation: node.explanation, references }];
    });
    if (!nodes.length) return [];
    const edges = (Array.isArray(diagram.edges) ? diagram.edges : []).filter(e => e && ids.has(e.from) && ids.has(e.to)).slice(0, 60).map(e => ({ from: e.from, to: e.to, label: typeof e.label === 'string' ? e.label : '', kind: ['call', 'transition', 'data', 'conditional'].includes(e.kind) ? e.kind : 'transition' }));
    return [{ id: `diagram-${index + 1}`, title: diagram.title, kind: ['call-chain', 'lifecycle', 'data-flow'].includes(diagram.kind) ? diagram.kind : 'call-chain', nodes, edges }];
  });
}
