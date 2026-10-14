// Refining saved explanations (kind 'refine'): the agent revises, adds or removes notes of
// several files at once, following the user's request and the add/delete options.
//   refineRequest → (agent) → planRefinement (verify against inspected code) → applyRefinement (store)
// Revisions keep the note group (older versions stay available); removals are soft deletes.
import { readSource, locateNote, fail } from '../source/source.mjs';
import { inspectedRanges, sourceKey } from '../source/inspected-ranges.mjs';
import { normalizeSection } from './results.mjs';

export const MAX_REFINE_FILES = 10;
const MAX_RANGES = 40, MAX_CHARS = 100000;
const teaching = (a, b) => (a.sequenceAt || a.createdAt).localeCompare(b.sequenceAt || b.createdAt) || (a.order ?? a.start) - (b.order ?? b.start) || a.start - b.start;
const currentNotes = (notes, workspaceId, file) => notes.filter(n => n.workspaceId === workspaceId && !n.deletedAt && n.selected && sourceKey(n.path) === sourceKey(file)).sort(teaching);

// Current notes of the chosen files, located in today's source. Their ranges are attached as
// excerpts (within budget) so unchanged code needs no extra reads.
export async function refineRequest({ store, w, body }) {
  if (!w.root) throw fail('해설을 다듬으려면 소스 작업공간을 먼저 연결하세요.');
  const paths = [...new Set((Array.isArray(body.paths) ? body.paths : []).filter(p => typeof p === 'string' && p))];
  if (!paths.length) throw fail('다듬을 파일을 하나 이상 선택하세요.');
  if (paths.length > MAX_REFINE_FILES) throw fail(`한 번에 최대 ${MAX_REFINE_FILES}개 파일을 다듬을 수 있습니다.`);
  const notes = [], raw = [];
  let chars = 0;
  for (const file of paths) {
    const own = currentNotes(store.data.notes, w.id, file);
    if (!own.length) throw fail(`${file}에 다듬을 해설이 없습니다.`);
    const source = await readSource(w, file).catch(() => null);
    for (const n of own) {
      const located = source ? locateNote(n, source) : { ...n, sourceState: 'missing' };
      notes.push(located);
      if (!source || ['changed', 'missing'].includes(located.sourceState)) continue;
      const size = source.text.split('\n').slice(located.start - 1, located.end).join('\n').length;
      if (raw.length < MAX_RANGES && chars + size <= MAX_CHARS) { raw.push({ path: source.path, start: located.start, end: located.end }); chars += size; }
    }
  }
  return { paths, notes, raw, allowAdd: body.allowAdd === true, allowDelete: body.allowDelete === true };
}

// What the agent sees: per file, the current notes in teaching order.
export function existingForPrompt({ paths, notes }) {
  return paths.map(file => ({ path: file, notes: notes.filter(n => sourceKey(n.path) === sourceKey(file)).map(n => ({
    noteId: n.id, title: n.title, start: n.start, end: n.end, sourceState: n.sourceState, overview: n.overview || '',
    ...(n.details?.length ? { details: n.details.map(({ title, text, start, end }) => ({ title: title || '', text, start, end })) } : { body: n.body }),
  })) }));
}

/** Verifies the agent's changes. Returns { updates:[{prior, note, key}], added:[{note, key}], removed:[id], order } and warns about the rest. */
export function planRefinement({ result, context, refine, base, warnings }) {
  const { notes, paths, allowAdd, allowDelete } = refine;
  const byId = new Map(notes.map(n => [n.id, n])), ranges = inspectedRanges(context), used = new Set();
  const updates = [], added = [];
  result.sections.forEach((s, index) => {
    const key = String(s.noteId || `new-${index + 1}`), prior = byId.get(key);
    if (used.has(key)) { warnings.push(`${index + 1}번 해설 제외: 같은 해설(${key})을 두 번 수정했습니다.`); return; }
    if (!prior && !allowAdd) { warnings.push(`${index + 1}번 해설 제외: 새 해설 추가가 허용되지 않았습니다.`); return; }
    const file = prior?.path || s.path;
    if (prior && s.path && sourceKey(s.path) !== sourceKey(prior.path)) { warnings.push(`${index + 1}번 해설 제외: 기존 해설을 다른 파일(${s.path})로 옮길 수 없습니다.`); return; }
    if (!paths.some(p => sourceKey(p) === sourceKey(file))) { warnings.push(`${index + 1}번 해설 제외: 선택한 파일(${file || '미지정'})이 아닙니다.`); return; }
    const summary = prior?.summary ?? notes.find(n => sourceKey(n.path) === sourceKey(file))?.summary ?? '';
    // A revision may leave the title empty when only the text changed.
    const note = normalizeSection({ ...s, path: file, title: s.title?.trim() ? s.title : prior?.title }, index, { ranges, base, summary, warnings });
    if (!note) return;
    used.add(key);
    // A revision keeps its links: diagrams stay verifiable against the record that produced them, and the
    // original question stays reachable.
    if (prior) {
      if (prior.diagrams?.length) Object.assign(note, { diagrams: prior.diagrams, diagramRecordId: prior.diagramRecordId || prior.generationId });
      for (const field of ['sourceConversationId', 'sourceChatId']) if (prior[field]) note[field] = prior[field];
      updates.push({ prior, note, key });
    }
    else added.push({ note, key });
  });
  const removals = Array.isArray(result.removed) ? result.removed : [];
  if (removals.length && !allowDelete) warnings.push(`삭제 제안 ${removals.length}개는 삭제가 허용되지 않아 적용하지 않았습니다.`);
  const removed = allowDelete ? removals.filter(r => byId.has(r.noteId) && !used.has(r.noteId)).map(r => r.noteId) : [];
  return { paths, updates, added, removed: [...new Set(removed)], order: Array.isArray(result.order) ? result.order : [] };
}

// Applies a verified plan inside store.update. Notes changed elsewhere meanwhile (deleted or
// replaced by a newer revision) are skipped. Every refined file gets the agent's teaching order;
// notes it did not mention keep their previous relative order after the mentioned ones.
export function applyRefinement(d, plan, { workspaceId, sequenceAt, warnings }) {
  const now = new Date().toISOString(), ids = new Map(), applied = [];
  // A revision inherits its predecessor's place; new notes go last unless the agent ordered them.
  const previous = new Map(plan.paths.flatMap(file => currentNotes(d.notes, workspaceId, file).map((n, i) => [n.id, i])));
  for (const { prior, note, key } of plan.updates) {
    const current = d.notes.find(n => n.id === prior.id);
    if (!current || current.deletedAt || !current.selected) { warnings.push(`‘${prior.title}’ 해설이 그사이 변경되어 수정하지 않았습니다.`); continue; }
    const group = d.notes.filter(n => n.groupId === current.groupId);
    Object.assign(note, { groupId: current.groupId, revision: Math.max(...group.map(n => n.revision)) + 1 });
    for (const n of group) n.selected = false;
    d.notes.push(note); ids.set(key, note.id); applied.push(note); previous.set(note.id, previous.get(current.id));
  }
  for (const { note, key } of plan.added) { d.notes.push(note); ids.set(key, note.id); applied.push(note); }
  const removed = [];
  for (const id of plan.removed) { const n = d.notes.find(n => n.id === id && !n.deletedAt); if (n) { n.deletedAt = now; removed.push(id); } }
  for (const file of plan.paths) {
    const listed = plan.order.find(o => sourceKey(o.path) === sourceKey(file))?.noteIds || [];
    const rank = new Map(listed.map((key, i) => [ids.get(key) || key, i]));
    const current = currentNotes(d.notes, workspaceId, file), at = (map, n) => map.get(n.id) ?? Number.MAX_SAFE_INTEGER;
    current.sort((a, b) => at(rank, a) - at(rank, b) || at(previous, a) - at(previous, b));
    current.forEach((n, order) => { n.order = order; n.sequenceAt = sequenceAt; });
  }
  return { applied, removed };
}
