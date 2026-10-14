// Source workspaces: open/relocate, activate, file index, file contents with notes, code search,
// per-workspace UI session, and diagram source links.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { asyncRoute } from '../http/security.mjs';
import { readSource, locateNote, makeIndex, engineVersion, fail, inside } from '../source/source.mjs';
import { demoNotes } from '../domain/demo.mjs';
import { searchCode } from '../source/code-search.mjs';

export function workspaceRoutes(app, { store, indexes, codeIndexes, dataDir, projectRoot, workspace, getIndex, fileNotes }) {
  app.post('/api/workspaces', asyncRoute(async (req, res) => {
    const rootInput = req.body.demo ? path.join(projectRoot, 'samples') : req.body.root;
    if (typeof rootInput !== 'string' || !path.isAbsolute(rootInput)) throw fail('소스 폴더의 절대 경로를 입력하세요.');
    let root;
    try { root = await fs.realpath(rootInput); if (!(await fs.stat(root)).isDirectory()) throw Error(); } catch { throw fail('폴더를 찾을 수 없습니다. 경로와 접근 권한을 확인하세요.'); }
    if (inside(root, path.resolve(dataDir))) throw fail('앱 데이터 폴더를 포함하는 상위 폴더는 소스 작업공간으로 지정할 수 없습니다.');
    const version = req.body.demo ? '예제' : await engineVersion(root);
    let result;
    await store.update(async data => {
      let w = req.body.relocateId ? data.workspaces.find(w => w.id === req.body.relocateId) : data.workspaces.find(w => w.root.toLowerCase() === root.toLowerCase());
      if (req.body.relocateId && !w) throw fail('이동할 작업공간이 없습니다.');
      if (w) { w.root = root; w.version = version; }
      else { w = { id: randomUUID(), root, name: req.body.demo ? 'Reader Demo' : path.basename(root), version, demo: !!req.body.demo }; data.workspaces.push(w); }
      data.activeWorkspace = w.id; result = w;
      if (req.body.demo && !data.notes.some(n => n.workspaceId === w.id)) data.notes.push(...await demoNotes(root, w.id));
    });
    indexes.get(result.id) && (indexes.get(result.id).cancel = true); indexes.delete(result.id);
    getIndex(result);
    res.json(result);
  }));
  // Extra source folders (e.g. a game project next to the engine), mounted under a top-level name.
  // body: { path, name? }. Removing a folder keeps its explanations; re-adding the same name reconnects them.
  const reindex = w => { const previous = indexes.get(w.id); if (previous) previous.cancel = true; indexes.delete(w.id); getIndex(w); };
  app.post('/api/workspaces/:id/folders', asyncRoute(async (req, res) => {
    const w = workspace(req.params.id);
    if (!w.root) throw fail('소스 작업공간에만 폴더를 추가할 수 있습니다.');
    if (typeof req.body.path !== 'string' || !path.isAbsolute(req.body.path)) throw fail('추가할 폴더의 절대 경로를 입력하세요.');
    let folder;
    try { folder = await fs.realpath(req.body.path); if (!(await fs.stat(folder)).isDirectory()) throw Error(); } catch { throw fail('폴더를 찾을 수 없습니다. 경로와 접근 권한을 확인하세요.'); }
    if (inside(folder, path.resolve(dataDir))) throw fail('앱 데이터 폴더를 포함하는 폴더는 추가할 수 없습니다.');
    const name = String(req.body.name || path.basename(folder)).trim();
    if (!name || name.length > 60 || /[\\/:*?"<>|]/.test(name) || /^\.+$/.test(name)) throw fail('폴더 이름은 60자 이하이며 \\ / : * ? " < > | 를 쓸 수 없습니다.');
    const folders = w.folders || [];
    for (const other of [w.root, ...folders.map(f => f.path)]) if (inside(other, folder) || inside(folder, other)) throw fail(`이미 작업공간에 포함된 폴더와 겹칩니다: ${other}`);
    if (folders.some(f => f.name.toLowerCase() === name.toLowerCase())) throw fail(`같은 이름(${name})의 폴더가 이미 있습니다. 다른 이름을 지정하세요.`);
    const top = await fs.readdir(w.root).catch(() => []);
    if (top.some(entry => entry.toLowerCase() === name.toLowerCase())) throw fail(`기본 폴더에 같은 이름(${name})의 항목이 있어 경로가 겹칩니다. 다른 이름을 지정하세요.`);
    await store.update(d => { const target = d.workspaces.find(x => x.id === w.id); target.folders = [...(target.folders || []), { name, path: folder }]; });
    reindex(workspace(w.id));
    res.json(workspace(w.id));
  }));
  app.delete('/api/workspaces/:id/folders/:name', asyncRoute(async (req, res) => {
    const w = workspace(req.params.id), name = String(req.params.name).toLowerCase();
    if (!(w.folders || []).some(f => f.name.toLowerCase() === name)) throw fail('작업공간에 없는 폴더입니다.', 404);
    await store.update(d => { const target = d.workspaces.find(x => x.id === w.id); target.folders = target.folders.filter(f => f.name.toLowerCase() !== name); });
    reindex(workspace(w.id));
    res.json(workspace(w.id));
  }));
  app.post('/api/workspaces/:id/activate', asyncRoute(async (req, res) => { workspace(req.params.id); await store.update(d => { d.activeWorkspace = req.params.id; }); res.json({ ok: true }); }));
  app.put('/api/workspaces/:id/session', asyncRoute(async (req, res) => {
    workspace(req.params.id);
    await store.update(d => { d.sessions[req.params.id] = req.body; }); res.json({ ok: true });
  }));

  app.get('/api/workspaces/:id/files', asyncRoute(async (req, res) => {
    const index = getIndex(workspace(req.params.id));
    if (req.query.all === '1') {
      const revision = `${index.id}:${index.files.length}:${index.status}:${index.skipped}`;
      return res.json({ files: req.query.revision === revision ? undefined : index.files, revision, count: index.files.length, total: index.files.length, status: index.status, skipped: index.skipped });
    }
    const q = String(req.query.q || '').toLowerCase();
    const files = index.files.filter(f => f.toLowerCase().includes(q));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    res.json({ files: files.slice(offset, offset + 300), count: files.length, total: index.files.length, status: index.status, skipped: index.skipped });
  }));
  app.post('/api/workspaces/:id/index', asyncRoute(async (req, res) => {
    const w = workspace(req.params.id);
    if (req.body.cancel) getIndex(w).cancel = true;
    else { const previous = indexes.get(w.id); if (previous) previous.cancel = true; indexes.set(w.id, makeIndex(w)); codeIndexes.get(w)?.update(); }
    res.json({ ok: true });
  }));
  app.get('/api/workspaces/:id/file', asyncRoute(async (req, res) => res.json(await fileNotes(workspace(req.params.id), String(req.query.path || '')))));
  // With a ready code index only candidate files are read; results are verified against current text.
  app.get('/api/workspaces/:id/search', asyncRoute(async (req, res) => {
    const w = workspace(req.params.id), index = getIndex(w);
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [], scanned: 0, total: index.files.length, complete: true });
    let disconnected = false; res.on('close', () => { disconnected = true; });
    const code = codeIndexes.get(w), candidates = code?.ready() ? await code.candidates(q).catch(() => null) : null;
    const files = candidates ?? [...index.files];
    const found = await searchCode({ root: w, files, query: q, cancelled: () => disconnected });
    if (!disconnected) res.json({ results: found.results, scanned: found.scanned, total: index.files.length, candidates: candidates?.length ?? null, skipped: found.skipped, indexed: !!candidates,
      complete: found.exhausted && (candidates ? code.status().status === 'ready' : index.status === 'ready') });
  }));

  app.post('/api/workspaces/:id/diagram-reference', asyncRoute(async (req, res) => {
    const w = workspace(req.params.id);
    const { recordId, diagramId, nodeId, referenceIndex, noteId } = req.body;
    const nodeIn = id => store.data.conversations.find(c => c.id === id && c.workspaceId === w.id)?.diagrams?.find(d => d.id === diagramId)?.nodes.find(n => n.id === nodeId);
    // Revisions made before diagramRecordId existed point at a record without diagrams: use the note group's history.
    const group = noteId ? store.data.notes.find(n => n.id === noteId && n.workspaceId === w.id)?.groupId : null;
    const node = nodeIn(recordId) || (group ? store.data.notes.filter(n => n.groupId === group).map(n => nodeIn(n.diagramRecordId || n.generationId)).find(Boolean) : null);
    const ref = Number.isInteger(referenceIndex) && referenceIndex >= 0 ? node?.references[referenceIndex] : null;
    if (!ref || !w.root) throw fail('시각화의 코드 연결을 찾을 수 없습니다.', 404);
    const located = locateNote(ref, await readSource(w, ref.path));
    if (located.sourceState === 'changed') throw fail('저장 이후 코드가 변경되어 위치를 확정할 수 없습니다. 설명은 계속 볼 수 있습니다. 현재 코드로 흐름을 다시 분석하세요.', 409);
    res.json({ path: ref.path, start: located.start, end: located.end, sourceState: located.sourceState });
  }));
}
