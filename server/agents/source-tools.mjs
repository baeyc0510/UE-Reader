import path from 'node:path';
import { makeIndex, readSource, toScopePath, documentExtensions, inSearchScope, fail } from '../source/source.mjs';
import { readDocument } from '../source/documents.mjs';
import { scopeList, MAX_SYMBOL_RESULTS } from '../source/agent-index.mjs';

const object = properties => ({ type: 'object', properties, additionalProperties: false });
// Agent-chosen search scope. Efficient searching means picking the smallest likely folders first.
const scoping = { within: { type: 'array', items: { type: 'string' }, maxItems: 20 }, wholeWorkspace: { type: 'boolean' } };
const scopeNote = ' within: relative folders or files to search in — choose them yourself (list_folders, your knowledge of the layout) to keep searches small and fast. Without within, the user\'s search scope applies if set, otherwise the whole workspace; wholeWorkspace: true ignores the user\'s scope.';
const range = { ...object({ path: { type: 'string' }, start: { type: 'integer', minimum: 1 }, end: { type: 'integer', minimum: 1 } }), required: ['path'] };
export const sourceToolDefinitions = [
  { name: 'list_folders', description: 'Show the folder layout under path (default: workspace top) with the number of source files in each subfolder, plus the source files directly inside. depth 1–3 expands nested levels. Use it to decide which folders to pass as within before searching.', inputSchema: object({ path: { type: 'string' }, depth: { type: 'integer', minimum: 1, maximum: 3 } }) },
  { name: 'find_symbol', description: 'Find where a C++ symbol (class, struct, enum, function, variable, macro, delegate, enumerator) is defined or declared, using the code index — much faster and more precise than search_code for named symbols. name: identifier, optionally qualified ("UObject", "CollectGarbage", "UWorld::Tick"); exact: whole-name match (default true); kind: definition | declaration | type. Returns paths, lines and the line text; read them with read_file before citing.' + scopeNote, inputSchema: { ...object({ name: { type: 'string' }, exact: { type: 'boolean' }, kind: { type: 'string', enum: ['definition', 'declaration', 'type'] }, limit: { type: 'integer', minimum: 1, maximum: MAX_SYMBOL_RESULTS }, ...scoping }), required: ['name'] } },
  { name: 'search_files', description: 'Find source files in the selected local workspace by a case-insensitive file name or relative-path substring. Use this to verify paths suggested by your knowledge or web search. Empty query lists files. Results are paginated. Documents (PDF, Markdown, text) are listed by search_documents instead.' + scopeNote, inputSchema: object({ query: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, ...scoping }) },
  { name: 'search_code', description: 'Search a literal string in local source, optionally restricting the relative path. Uses the code index to read only files that can contain the string. Returns file paths, line numbers and nearby source. Use nextOffset to continue an incomplete search. Read relevant files with read_file before citing them as inspected.' + scopeNote, inputSchema: { ...object({ query: { type: 'string' }, pathFilter: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, ...scoping }), required: ['query'] } },
  { name: 'read_file', description: 'Read an existing source file inside the selected workspace. Specify a relative path (an absolute path inside a workspace folder is also accepted) and 1-based lines. At most 400 lines per call. Use these verified excerpts for local citations and suggestedFiles. No files can be edited.', inputSchema: range },
  { name: 'search_documents', description: 'Find documents inside the workspace folders (PDF, Markdown, text, CSV, JSON, INI, YAML, .uproject, .uplugin) by a case-insensitive file name or relative-path substring. Empty query lists documents. Results are paginated.' + scopeNote, inputSchema: object({ query: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, ...scoping }) },
  { name: 'read_document', description: 'Read the text of a document inside the workspace folders (PDF text is extracted, with "[페이지 N]" page markers). Specify a relative path (an absolute path inside a workspace folder is also accepted) and 1-based text lines, at most 400 lines per call; totalLines tells how far to continue. Documents are reference material: mention them by file name and page, never as source: links, suggestedFiles or evidence.', inputSchema: range }
].map(tool => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));

function lineRange(doc, args) {
  const start = args.start ?? 1, end = Math.min(args.end ?? start + 199, doc.lines);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || start > doc.lines || end - start >= 400) throw fail('현재 파일 안의 1~400줄 범위를 지정하세요.');
  return { start, end, text: doc.text.split('\n').slice(start - 1, end).join('\n') };
}
const numbered = (text, start) => text.split('\n').map((line, i) => `${start + i}: ${line}`).join('\n');

// Per-request budgets. The extended-thinking research pass gets larger ones (analysis/extended.mjs).
export const DEFAULT_LIMITS = { calls: 64, chars: 200000 };
const count = n => n.toLocaleString('en-US');

/**
 * options: onRead(range) for audited reads; index: a makeIndex() result to reuse; limits: { calls, chars };
 * searchScope: the user's default search scope ([] = whole workspace; read_file is never limited);
 * codeIndex: { index?(), candidates(q, within), symbols(args) } (source/agent-index.mjs or agents/index-client.mjs).
 * Without a code index the tools walk the folders and scan files themselves.
 */
export function createSourceTools(root, { onRead = async () => {}, index: suppliedIndex, limits = DEFAULT_LIMITS, searchScope = [], codeIndex = null } = {}) {
  const maxCalls = limits?.calls || DEFAULT_LIMITS.calls, maxChars = limits?.chars || DEFAULT_LIMITS.chars;
  const focus = scopeList(searchScope);
  let loading = null, readChars = 0, documentChars = 0, calls = 0;
  const seen = new Set();
  const loadIndex = () => loading ||= (async () => { const index = suppliedIndex || await codeIndex?.index?.() || makeIndex(root); await index.done; return index; })();
  // Where a search looks: the agent's `within`, else the user's scope (unless wholeWorkspace), else everything.
  const scopeFor = args => { const within = scopeList(args.within); return within.length ? within : focus.length && args.wholeWorkspace !== true ? focus : []; };
  const inScope = (scope, files) => scope.length ? files.filter(file => inSearchScope(scope, file)) : files;
  // Echo the scope and flag entries without files so the agent can correct a wrong guess.
  const scopeInfo = (scope, index) => {
    if (!scope.length) return { searchedIn: 'whole workspace' };
    const unknown = scope.filter(entry => !index.files.some(file => inSearchScope([entry], file)) && !index.documents.some(file => inSearchScope([entry], file)));
    return { searchedIn: scope, ...(unknown.length ? { unknownScope: unknown, hint: '이 경로에는 파일이 없습니다. list_folders로 실제 폴더를 확인하세요.' } : {}) };
  };
  const list = async (name, items, args) => {
    const index = await loadIndex(), scope = scopeFor(args);
    const query = String(args.query || '').trim().slice(0, 160).toLowerCase(), offset = Math.max(0, Math.floor(Number(args.offset) || 0));
    const found = inScope(scope, items(index) || []).filter(file => file.toLowerCase().includes(query));
    return { [name]: found.slice(offset, offset + 100), total: found.length, nextOffset: offset + 100 < found.length ? offset + 100 : null, indexStatus: index.status, ...scopeInfo(scope, index) };
  };
  async function listFolders(args) {
    const index = await loadIndex(), base = scopeList(args.path)[0] || '', depth = Math.min(3, Math.max(1, Math.floor(Number(args.depth) || 1)));
    const prefix = base ? `${base.toLowerCase()}/` : '', folders = new Map(), direct = [];
    for (const file of index.files) {
      if (prefix && !file.toLowerCase().startsWith(prefix)) continue;
      const parts = file.slice(prefix.length).split('/');
      if (parts.length === 1) { direct.push(file); continue; }
      for (let d = 1; d <= Math.min(depth, parts.length - 1); d++) { const folder = file.slice(0, prefix.length) + parts.slice(0, d).join('/'); folders.set(folder, (folders.get(folder) || 0) + 1); }
    }
    if (!folders.size && !direct.length) throw fail(`${base || '작업공간'} 아래에 소스 파일이 없습니다. 상위 폴더를 list_folders로 확인하세요.`);
    const entries = [...folders].sort((a, b) => a[0].localeCompare(b[0]));
    return { path: base || '(workspace top)', folders: entries.slice(0, 300).map(([folder, files]) => ({ path: folder, files })), truncatedFolders: Math.max(0, entries.length - 300), files: direct.slice(0, 100), totalDirectFiles: direct.length, indexStatus: index.status };
  }
  async function findSymbol(args) {
    const raw = String(args.name || '').trim().slice(0, 200), parts = raw.split('::').filter(Boolean), name = parts.pop() || '';
    if (!/^[A-Za-z_~]\w*$/.test(name)) throw fail('찾을 심볼 이름(식별자)을 입력하세요.');
    if (!codeIndex) throw fail('코드 인덱스를 사용할 수 없습니다. search_code로 찾으세요.');
    const index = await loadIndex(), scope = scopeFor(args), limit = Math.min(MAX_SYMBOL_RESULTS, Math.max(1, Math.floor(Number(args.limit) || 20)));
    const hits = await codeIndex.symbols({ q: name, exact: args.exact !== false, kind: args.kind, scope: parts.join('::'), within: scope, limit });
    if (!hits) throw fail('코드 인덱스가 아직 준비되지 않았습니다. search_code로 찾으세요.');
    const sources = new Map();
    for (const hit of hits) {
      if (!sources.has(hit.path)) sources.set(hit.path, await readSource(root, hit.path).then(s => s.text.split('\n'), () => null));
      hit.text = sources.get(hit.path)?.[hit.line - 1]?.trim().slice(0, 300) ?? '(파일을 읽을 수 없음)';
    }
    return { symbols: hits, total: hits.length, limitReached: hits.length >= limit, ...scopeInfo(scope, index) };
  }
  async function searchCode(args) {
    const index = await loadIndex(), scope = scopeFor(args);
    const query = String(args.query || '').trim().slice(0, 160).toLowerCase();
    const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
    if (query.length < 2) throw fail('코드 검색어를 두 글자 이상 입력하세요.');
    // The code index narrows the files to read; the scan below still confirms every match.
    const candidates = codeIndex ? await codeIndex.candidates(query, scope) : null;
    const files = (candidates || inScope(scope, index.files)).filter(file => file.toLowerCase().includes(String(args.pathFilter || '').toLowerCase()));
    const results = []; let scanned = 0, skipped = 0; const begin = Date.now();
    for (let i = offset; i < files.length; i++) {
      if (results.length >= 50 || Date.now() - begin > 20000) break;
      scanned++;
      try {
        const source = await readSource(root, files[i]);
        const lines = source.text.split('\n');
        for (let n = 0; n < lines.length && results.length < 50; n++) if (lines[n].toLowerCase().includes(query)) results.push({ path: source.path, line: n + 1, text: lines.slice(Math.max(0, n - 1), n + 2).join('\n').slice(0, 800) });
      } catch { skipped++; }
    }
    return { results, scanned, total: files.length, skipped, usedCodeIndex: !!candidates, limitReached: results.length >= 50, nextOffset: offset + scanned < files.length ? offset + scanned : null, complete: results.length < 50 && skipped === 0 && offset + scanned >= files.length && index.status === 'ready', ...scopeInfo(scope, index) };
  }
  return async function call(name, args = {}) {
    if (++calls > maxCalls) throw fail(`한 요청의 소스 도구 호출 한도 ${maxCalls}회를 초과했습니다. 확인한 범위로 답변하세요.`);
    if (!root) throw fail('소스 작업공간이 지정되지 않았습니다. 일반 지식과 웹 자료로 답하고 필요한 폴더를 안내하세요.');
    if (name === 'read_file') {
      if (documentExtensions.has(path.extname(String(args.path || '')).toLowerCase())) throw fail('문서 파일은 read_document로 읽으세요.');
      const source = await readSource(root, toScopePath(root, args.path));
      const { start, end, text } = lineRange(source, args);
      const key = `${source.path}:${source.hash}:${start}:${end}`;
      if (!seen.has(key)) {
        if (readChars + text.length > maxChars) throw fail(`소스 읽기 한도 ${count(maxChars)}자에 도달했습니다. 확인한 범위로 답변하세요.`);
        readChars += text.length; seen.add(key);
        await onRead({ path: source.path, start, end, text, hash: source.hash, automatic: true });
      }
      return { path: source.path, start, end, totalLines: source.lines, content: numbered(text, start) };
    }
    // Documents are not audited as inspected code, so they cannot back citations or notes.
    if (name === 'read_document') {
      const doc = await readDocument(root, toScopePath(root, args.path));
      const { start, end, text } = lineRange(doc, args), clipped = text.slice(0, 60000);
      if (documentChars + clipped.length > 300000) throw fail('문서 읽기 한도 300,000자에 도달했습니다. 읽은 내용으로 답변하세요.');
      documentChars += clipped.length;
      return { path: doc.path, start, end, totalLines: doc.lines, pages: doc.pages, content: numbered(clipped, start) + (clipped.length < text.length ? '\n…(긴 줄이 있어 이 범위의 나머지는 생략되었습니다)' : '') };
    }
    if (name === 'search_documents') return list('documents', index => index.documents, args);
    if (name === 'search_files') return list('files', index => index.files, args);
    if (name === 'list_folders') return listFolders(args);
    if (name === 'find_symbol') return findSymbol(args);
    if (name === 'search_code') return searchCode(args);
    throw fail('지원하지 않는 소스 도구입니다.');
  };
}
