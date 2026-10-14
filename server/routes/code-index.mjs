// Code index: build status, refresh/rebuild, symbol search, go to definition/declaration, and the agent index bridge.
import { asyncRoute } from '../http/security.mjs';
import { readSource, fail } from '../source/source.mjs';
import { extractSymbols, findLocalDeclaration } from '../source/code-index/cpp-symbols.mjs';

const KIND_FILTERS = ['definition', 'declaration', 'type'];

// Adds the current text of each result line; `stale` marks files that can no longer be read.
async function withPreviews(root, results) {
  const previews = new Map();
  for (const r of results) {
    if (!previews.has(r.path)) previews.set(r.path, await readSource(root, r.path).then(s => s.text.split('\n'), () => null));
    r.preview = previews.get(r.path)?.[r.line - 1]?.trim().slice(0, 200) ?? '';
    r.stale = !previews.get(r.path);
  }
  return results;
}

export function codeIndexRoutes(app, { codeIndexes, workspace, getIndex, agentIndex }) {
  const indexFor = id => { const w = workspace(id); if (!w.root) throw fail('소스 작업공간에서만 코드 인덱스를 사용할 수 있습니다.'); getIndex(w); const code = codeIndexes.get(w); if (!code) throw fail('코드 인덱스를 사용하지 않는 실행 환경입니다.', 503); return code; };
  // Agent source tools (MCP process) query the file and code indexes with the token their request was granted.
  // body: { op: files | candidates | symbols, args }
  app.post('/api/agent-index', asyncRoute(async (req, res) => res.json({ result: await agentIndex.query(String(req.headers['x-ue-reader-agent-token'] || ''), req.body.op, req.body.args) })));
  app.get('/api/workspaces/:id/code-index', asyncRoute(async (req, res) => res.json(indexFor(req.params.id).status())));
  // body: { full } — full=true reparses every file; otherwise only changed files.
  app.post('/api/workspaces/:id/code-index', asyncRoute(async (req, res) => { const code = indexFor(req.params.id); code.update(req.body.full === true); res.json(code.status()); }));

  // ?q=&exact=1&kind=definition|declaration|type&scope=Owner&near=current/path&limit=
  app.get('/api/workspaces/:id/symbols', asyncRoute(async (req, res) => {
    const w = workspace(req.params.id), code = indexFor(req.params.id);
    const q = String(req.query.q || '').trim().slice(0, 200);
    if (!code.ready()) return res.json({ ready: false, status: code.status(), results: [] });
    if (!q) return res.json({ ready: true, results: [] });
    const kind = KIND_FILTERS.includes(req.query.kind) ? req.query.kind : undefined;
    const args = { q, exact: req.query.exact === '1', kind, scope: String(req.query.scope || ''), near: String(req.query.near || ''), limit: Math.min(200, Math.max(1, Number(req.query.limit) || 100)) };
    let results = await code.symbols(args), fallback = false;
    // Interfaces and pure virtuals have no body; variables have no separate declaration.
    if (!results?.length && (kind === 'definition' || kind === 'declaration')) { results = await code.symbols({ ...args, kind: kind === 'definition' ? 'declaration' : 'definition' }); fallback = true; }
    res.json({ ready: true, fallback, results: await withPreviews(w, results || []) });
  }));

  // Go to definition/declaration of the identifier at path:line. Order: a parameter or local variable of the
  // enclosing function (unless qualified or a member access), then index symbols ranked by the scope around
  // the click (its own class first, then enclosing namespaces).
  // ?path=&line=&word=&scope=Owner&member=1&kind=definition|declaration
  app.get('/api/workspaces/:id/definition', asyncRoute(async (req, res) => {
    const w = workspace(req.params.id), code = indexFor(req.params.id);
    const word = String(req.query.word || ''), file = String(req.query.path || ''), line = Math.max(1, Number(req.query.line) || 1), scope = String(req.query.scope || '');
    const kind = req.query.kind === 'declaration' ? 'declaration' : 'definition';
    if (!/^[A-Za-z_]\w*$/.test(word)) throw fail('식별자를 선택하세요.');
    const text = file ? await readSource(w, file).then(s => s.text, () => '') : '';
    if (text && !scope && req.query.member !== '1') {
      const local = findLocalDeclaration(text, line, word);
      if (local) return res.json({ ready: true, source: 'local', results: await withPreviews(w, [{ name: word, kind: 'variable', line: local.line, scope: [local.function.scope, local.function.name].filter(Boolean).join('::'), path: file }]) });
    }
    if (!code.ready()) return res.json({ ready: false, status: code.status(), results: [] });
    const around = text ? extractSymbols(text, { stopAt: line }) : { scope: '', fn: null };
    const args = { q: word, exact: true, scope, context: around.fn?.scope || around.scope, near: file, limit: 50 };
    let results = await code.symbols({ ...args, kind }), fallback = false;
    if (!results?.length) { results = await code.symbols({ ...args, kind: kind === 'definition' ? 'declaration' : 'definition' }); fallback = true; }
    // `unique`: the best hit belongs to the click's scope more closely than any other, so the client can open it.
    const near = r => r?.scope && args.context && (args.context === r.scope || args.context.startsWith(r.scope + '::')) ? r.scope.split('::').length : 0;
    const unique = !!results?.length && near(results[0]) > 0 && near(results[0]) > near(results[1]);
    res.json({ ready: true, source: 'index', fallback, unique, context: args.context, results: await withPreviews(w, results || []) });
  }));
}
