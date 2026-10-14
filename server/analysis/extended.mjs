// Extended thinking ("확장된 사고"): before the request a research agent explores widely with a larger
// tool budget; for explanations a reviewing pass then supplements and polishes the verified draft.
// Every pass reuses the request's agent, model and source scope, and all code reads land in the same
// job context, so a later pass may cite what an earlier one read (and nothing else).
import { inspectedRanges, sourceKey } from '../source/inspected-ranges.mjs';
import { normalizeSection } from './results.mjs';

export const RESEARCH_LIMITS = { calls: 160, chars: 600000 };
const MAX_FINDINGS = 40, EXCERPT_CHARS = 80000;

const text = v => typeof v === 'string' ? v.trim() : '';

/** Research JSON → notes whose references are all inspected ranges (unbacked references are dropped). */
export function normalizeResearch(result, context) {
  const find = inspectedRanges(context).find;
  const findings = (Array.isArray(result?.findings) ? result.findings : []).filter(f => text(f?.detail)).slice(0, MAX_FINDINGS).map(f => ({
    topic: text(f.topic), detail: text(f.detail),
    references: (Array.isArray(f.references) ? f.references : []).flatMap(r => { const read = find(r); return read ? [{ path: read.path, start: r.start, end: r.end }] : []; }),
  }));
  const summary = text(result?.summary);
  if (!summary && !findings.length) throw Error('탐색 에이전트의 조사 결과가 비어 있습니다.');
  return { summary, findings, openQuestions: (Array.isArray(result?.openQuestions) ? result.openQuestions : []).map(text).filter(Boolean).slice(0, 20) };
}

/** The code behind the given ranges, merged per file and cut to a budget, for the next pass's prompt. */
export function excerptsFor(refs, context, budget = EXCERPT_CHARS) {
  const find = inspectedRanges(context).find, spans = new Map();
  for (const r of refs) {
    const read = find(r); if (!read) continue;
    const key = sourceKey(read.path), list = spans.get(key) || []; spans.set(key, list);
    list.push({ read, start: r.start, end: r.end });
  }
  const excerpts = []; let used = 0;
  for (const list of spans.values()) {
    list.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const s of list) { const last = merged.at(-1); if (last && last.read === s.read && s.start <= last.end + 1) last.end = Math.max(last.end, s.end); else merged.push({ ...s }); }
    for (const { read, start, end } of merged) {
      const body = read.text.split('\n').slice(start - read.start, end - read.start + 1).join('\n');
      if (used + body.length > budget) continue;
      used += body.length; excerpts.push({ path: read.path, start, end, text: body });
    }
  }
  return excerpts;
}

export const researchExcerpts = (notes, context) => excerptsFor(notes.findings.flatMap(f => f.references), context);

/** What the reviewer sees: the verified draft sections keyed draft-1..n, in teaching order. */
export const draftForReview = sections => sections.map((s, i) => ({
  noteId: `draft-${i + 1}`, path: s.path, title: s.title, start: s.start, end: s.end, overview: s.overview || '',
  ...(s.details?.length ? { details: s.details.map(({ title, text, start, end }) => ({ title: title || '', text, start, end })) } : { body: s.body }),
}));

/**
 * Merges the reviewer's changes into the draft: revised sections replace their draft, added ones join,
 * removals drop drafts, and `order` sets the teaching order. Changes not backed by inspected code are
 * dropped with a warning, keeping the draft section. Returns null when nothing would remain.
 */
export function applyReview({ result, draft, context, target, base, warnings }) {
  const ranges = inspectedRanges(context), keys = draft.map((_, i) => `draft-${i + 1}`);
  const byKey = new Map(keys.map((k, i) => [k, draft[i]])), changed = new Map(), added = new Map();
  const summary = draft[0]?.summary || '';
  (Array.isArray(result?.sections) ? result.sections : []).forEach((s, index) => {
    const key = String(s.noteId || `new-${index + 1}`), prior = byKey.get(key);
    if (changed.has(key) || added.has(key)) { warnings.push(`검토 ${index + 1}번 제외: 같은 해설(${key})을 두 번 수정했습니다.`); return; }
    if (prior && s.path && sourceKey(s.path) !== sourceKey(prior.path)) { warnings.push(`검토 ${index + 1}번 제외: 해설을 다른 파일(${s.path})로 옮길 수 없습니다.`); return; }
    const own = [];
    const note = normalizeSection({ ...s, path: prior?.path || s.path, title: text(s.title) ? s.title : prior?.title }, index, { ranges, target, base, summary, warnings: own });
    warnings.push(...own.map(w => `검토 단계 · ${w}`));
    if (!note) return;
    (prior ? changed : added).set(key, note);
  });
  const removed = new Set((Array.isArray(result?.removed) ? result.removed : []).map(r => r?.noteId).filter(id => byKey.has(id) && !changed.has(id)));
  const live = [...keys.filter(k => !removed.has(k)), ...added.keys()];
  if (!live.length) { warnings.push('검토 결과 남는 해설이 없어 초안을 그대로 저장했습니다.'); return null; }
  const listed = (Array.isArray(result?.order) ? result.order : []).flatMap(o => Array.isArray(o?.noteIds) ? o.noteIds : []);
  const rank = new Map(); for (const k of listed) if (live.includes(k) && !rank.has(k)) rank.set(k, rank.size);
  const ordered = live.map((k, i) => ({ k, i })).sort((a, b) => (rank.get(a.k) ?? Infinity) - (rank.get(b.k) ?? Infinity) || a.i - b.i).map(x => x.k);
  const sections = ordered.map(k => changed.get(k) || added.get(k) || byKey.get(k));
  sections.forEach((s, order) => { s.order = order; });
  return { sections, summary: text(result?.summary), updated: changed.size, added: added.size, removed: removed.size };
}
