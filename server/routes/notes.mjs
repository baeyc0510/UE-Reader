// Saved explanations: grouped listing (files → notes), content edits, rename/delete/version/re-anchor.
import { asyncRoute } from '../http/security.mjs';
import { readSource, locateNote, fail } from '../source/source.mjs';

const matches = (n, q) => `${n.title} ${n.path} ${n.body}`.toLowerCase().includes(q);

export function noteRoutes(app, { store, workspace }) {
  // ?q= search, ?path= one file. Without path the client groups by file (see /notes/files).
  app.get('/api/workspaces/:id/notes', asyncRoute(async (req, res) => {
    const w = workspace(req.params.id), q = String(req.query.q || '').toLowerCase(), file = req.query.path ? String(req.query.path) : null;
    const notes = store.data.notes.filter(n => n.workspaceId === w.id && !n.deletedAt && (!file || n.path === file) && matches(n, q));
    const sources = new Map();
    for (const n of notes) if (!sources.has(n.path)) sources.set(n.path, w.root ? await readSource(w, n.path).catch(() => null) : null);
    res.json(notes.map(n => sources.get(n.path) ? locateNote(n, sources.get(n.path)) : { ...n, sourceState: 'missing' }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }));
  // File summaries for the saved-explanation browser: only selected (current) revisions count.
  app.get('/api/workspaces/:id/notes/files', asyncRoute(async (req, res) => {
    const w = workspace(req.params.id), q = String(req.query.q || '').toLowerCase();
    const files = new Map();
    for (const n of store.data.notes) {
      if (n.workspaceId !== w.id || n.deletedAt || !matches(n, q)) continue;
      const entry = files.get(n.path) || { path: n.path, count: 0, updatedAt: '', titles: [] };
      if (n.selected) { entry.count++; if (entry.titles.length < 3) entry.titles.push(n.title); }
      if (n.createdAt > entry.updatedAt) entry.updatedAt = n.createdAt;
      files.set(n.path, entry);
    }
    res.json([...files.values()].filter(f => f.count || q).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }));
  app.patch('/api/notes/:id/content', asyncRoute(async (req, res) => {
    const { part, index, text, title, expectedText, expectedTitle } = req.body;
    if (!['body', 'overview', 'detail'].includes(part) || typeof text !== 'string' || !text.trim() || text.length > 30000 || typeof expectedText !== 'string') throw fail('해설 내용은 1~30,000자로 입력하세요.');
    if (part === 'detail' && (typeof title !== 'string' || title.length > 160 || typeof expectedTitle !== 'string')) throw fail('항목 제목은 160자 이하로 입력하세요.');
    await store.update(d => {
      const n = d.notes.find(n => n.id === req.params.id && !n.deletedAt);
      if (!n) throw fail('해설을 찾을 수 없습니다.', 404);
      if (part === 'body' && n.details?.length) throw fail('세부 항목을 각각 편집하세요.');
      const detail = part === 'detail' && Number.isInteger(index) && index >= 0 ? n.details?.[index] : undefined;
      if ((part === 'detail' && !detail) || (part === 'overview' && !n.overview)) throw fail('편집할 해설 블록을 찾을 수 없습니다.', 404);
      const original = part === 'detail' ? detail.text : n[part];
      if (original !== expectedText || (part === 'detail' && (detail.title || '') !== expectedTitle)) throw fail('이 블록이 다른 화면에서 변경되었습니다. 최신 내용을 확인한 뒤 다시 편집하세요. 입력한 내용은 편집창에 남아 있습니다.', 409);
      if (part === 'detail') { detail.text = text.trim(); detail.title = title.trim(); }
      else n[part] = text.trim();
      if (n.details?.length) n.body = [n.overview || '', ...n.details.map(detail => detail.text)].filter(Boolean).join('\n\n');
      n.editedAt = new Date().toISOString();
    });
    res.json({ ok: true });
  }));
  app.patch('/api/notes/:id', asyncRoute(async (req, res) => {
    await store.update(async d => {
      const n = d.notes.find(n => n.id === req.params.id); if (!n) throw fail('해설을 찾을 수 없습니다.', 404);
      if (typeof req.body.title === 'string' && req.body.title.trim()) n.title = req.body.title.trim().slice(0, 160);
      if (typeof req.body.deleted === 'boolean') n.deletedAt = req.body.deleted ? new Date().toISOString() : null;
      if (req.body.selected === true) for (const sibling of d.notes.filter(x => x.groupId === n.groupId)) sibling.selected = sibling.id === n.id;
      if (req.body.start !== undefined) {
        const source = await readSource(workspace(n.workspaceId), n.path);
        const start = Number(req.body.start), end = Number(req.body.end);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > source.lines) throw fail('유효한 라인 범위를 입력하세요.');
        n.start = start; n.end = end; n.details = []; n.hash = source.hash; n.snapshot = source.text.split('\n').slice(start - 1, end).join('\n');
      }
    }); res.json({ ok: true });
  }));
}
