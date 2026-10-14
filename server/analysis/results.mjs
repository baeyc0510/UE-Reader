// Turns an agent's JSON into verified records. Anything not backed by an inspected
// source range is dropped with a warning; valid parts of a response are always kept.
import { randomUUID } from 'node:crypto';
import { inspectedRanges, sourceKey } from '../source/inspected-ranges.mjs';
import { normalizeDiagrams } from './diagrams.mjs';

// A refinement may legitimately change nothing, so its sections can be empty.
export function validateShape(result, questionMode, allowEmpty = false) {
  if (!result || typeof result.summary !== 'string' || !result.summary.trim() || (!questionMode && (!Array.isArray(result.sections) || (!allowEmpty && result.sections.length === 0)))) throw Error('답변 형식을 확인할 수 없습니다. 다시 시도하세요.');
}

/** Sections keep the agent's order (`order`), which is the teaching order shown in the app. A question has
 * sections only when the user asked in chat for explanations (the agent chose the files, so no target). */
export function normalizeSections({ result, context, target, questionMode, base, warnings }) {
  if (!Array.isArray(result.sections) || (questionMode && !result.sections.length)) return [];
  const ranges = inspectedRanges(context);
  const sections = result.sections.flatMap((s, index) => normalizeSection(s, index, { ranges, target, base, summary: result.summary, warnings }) || []);
  sections.forEach((s, order) => { s.order = order; });
  return sections;
}

/** One agent section → a note record, or null (with a warning) when it is not backed by inspected code. */
export function normalizeSection(s, index, { ranges, target, base, summary, warnings }) {
  const inspected = ranges.find, relative = s.path || target?.path;
  const excerpt = inspected({ ...s, path: relative });
  // body is only a fallback: an overview or details are enough content on their own.
  const text = v => typeof v === 'string' && v.trim();
  const content = text(s.body) || text(s.overview) || (Array.isArray(s.details) && s.details.some(d => text(d?.text)));
  const reason = target && sourceKey(relative) !== sourceKey(target.path) ? `선택한 파일 ${target.path}과 다릅니다.`
    : !excerpt ? `확인한 범위: ${ranges.describe(relative)}. 읽지 않은 구간 또는 다른 소스 버전이 포함되어 있습니다.`
      : !text(s.title) || !content ? '제목 또는 해설 본문이 비어 있거나 형식이 올바르지 않습니다.' : '';
  if (reason) { warnings.push(`${index + 1}번 해설 제외 · ${relative || '파일 미지정'} L${s.start}–${s.end}: ${reason}`); return null; }
  const details = (Array.isArray(s.details) ? s.details : []).filter((d, i) => {
    const valid = typeof d.text === 'string' && d.text.trim() && d.start >= s.start && d.end <= s.end && inspected({ ...d, path: excerpt.path });
    if (!valid) warnings.push(`${index + 1}번 해설의 ${i + 1}번 문장 제외 · ${excerpt.path} L${d.start}–${d.end}: 함수 또는 확인한 범위를 벗어났습니다.`);
    return valid;
  }).map(d => ({ title: typeof d.title === 'string' ? d.title : '', text: d.text, start: d.start, end: d.end }));
  if (Array.isArray(s.details) && s.details.length && !details.length) return null;
  const overview = typeof s.overview === 'string' ? s.overview.trim() : '';
  const evidence = (s.evidence || []).flatMap(e => { const read = inspected(e); return read ? [{ ...e, path: read.path }] : []; });
  return { ...base, id: randomUUID(), groupId: randomUUID(), path: excerpt.path, start: s.start, end: s.end, title: s.title, overview,
    body: details.length ? [overview, ...details.map(d => d.text)].filter(Boolean).join('\n\n') : text(s.body) || overview, details, summary, evidence,
    hash: excerpt.hash, snapshot: excerpt.text.split('\n').slice(s.start - excerpt.start, s.end - excerpt.start + 1).join('\n'), revision: 1, selected: true, origin: 'agent' };
}

export function normalizeSuggestedFiles(result, context) {
  const inspected = inspectedRanges(context).find;
  return (result.suggestedFiles || []).filter(inspected).slice(0, 5).map(e => ({ path: inspected(e).path, start: e.start, end: e.end, reason: String(e.reason || '') }));
}

export function normalizeWebSources(result) {
  return (result.webSources || []).filter(s => { try { const u = new URL(s.url); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } }).slice(0, 20);
}

export { normalizeDiagrams };

// A regenerated section becomes a new revision of the matching note group. A single regenerated
// section keeps its reading position; a multi-section lesson brings its own teaching order.
export function attachRevisions(sections, notes, { workspaceId, noteId }) {
  const keepPosition = sections.length === 1;
  for (const [i, section] of sections.entries()) {
    const prior = i === 0 && noteId ? notes.find(n => n.id === noteId && n.workspaceId === workspaceId && n.path === section.path)
      : notes.find(n => !n.deletedAt && n.selected && n.workspaceId === workspaceId && n.path === section.path && n.snapshot === section.snapshot);
    if (!prior) continue;
    const group = notes.filter(n => n.groupId === prior.groupId);
    Object.assign(section, { groupId: prior.groupId, revision: Math.max(...group.map(n => n.revision)) + 1 }, keepPosition ? { sequenceAt: prior.sequenceAt || prior.createdAt, order: prior.order } : {});
    for (const n of group) n.selected = false;
  }
}
