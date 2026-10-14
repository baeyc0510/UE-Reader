// In-memory code index: per-file symbols and tokens plus derived lookup structures.
// Pure (no IO) so building and querying are testable without a worker thread.
// Engine scale (~60k files, ~1.3M symbols, ~2M tokens) uses about 1–2 GB, which is acceptable.
import { KINDS, TYPE_KINDS } from './cpp-symbols.mjs';
import { inSearchScope } from '../source.mjs';

export function createTables(names = [], tokens = []) {
  const nameIds = new Map(names.map((n, i) => [n, i])), tokenIds = new Map(tokens.map((t, i) => [t, i]));
  const intern = (list, ids, value) => { let id = ids.get(value); if (id === undefined) { id = list.length; list.push(value); ids.set(value, id); } return id; };
  return { names, tokens, name: value => intern(names, nameIds, value), token: value => intern(tokens, tokenIds, value) };
}

// symbols: [{name, kind, line, scope}] → flat Int32Array [nameId, kind, line, scopeId] per symbol.
export function packFile(tables, { path, size, mtime, symbols, tokens }) {
  const flat = new Int32Array(symbols.length * 4);
  symbols.forEach((s, i) => flat.set([tables.name(s.name), KINDS.indexOf(s.kind), s.line, tables.name(s.scope)], i * 4));
  return { path, size, mtime, symbols: flat, tokens: Uint32Array.from([...tokens].map(tables.token)) };
}

export function buildLookup({ names, tokens, files }) {
  // Inverted token index (token id → file indexes) in two typed arrays.
  const counts = new Uint32Array(tokens.length + 1);
  for (const f of files) for (const t of f.tokens) counts[t + 1]++;
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
  const postings = new Uint32Array(counts[tokens.length]), cursor = counts.slice(0, tokens.length);
  files.forEach((f, fileIndex) => { for (const t of f.tokens) postings[cursor[t]++] = fileIndex; });
  // Lower-case symbol name → [fileIndex, symbolIndex, ...]
  const byName = new Map();
  files.forEach((f, fileIndex) => {
    for (let s = 0; s < f.symbols.length; s += 4) {
      const key = names[f.symbols[s]].toLowerCase();
      let list = byName.get(key); if (!list) byName.set(key, list = []);
      list.push(fileIndex, s);
    }
  });
  return { names, tokens, files, offsets: counts, postings, byName };
}

/**
 * Files that can contain `query` (case-insensitive substring), or null when the index cannot narrow it.
 * within: optional relative folders/files the result is limited to (agent search scope).
 */
export function candidateFiles(lookup, query, within = []) {
  const runs = [...new Set(query.toLowerCase().match(/[a-z0-9_]{3,}/g) || [])].sort((a, b) => b.length - a.length).slice(0, 3);
  if (!runs.length || !lookup.files.length) return null;
  let selected = null;
  for (const run of runs) {
    const mark = new Uint8Array(lookup.files.length);
    lookup.tokens.forEach((token, id) => { if (token.includes(run)) for (let i = lookup.offsets[id]; i < lookup.offsets[id + 1]; i++) mark[lookup.postings[i]] = 1; });
    selected = selected ? selected.map((v, i) => v & mark[i]) : mark;
  }
  const paths = [];
  selected.forEach((v, i) => { if (v && (!within.length || inSearchScope(within, lookup.files[i].path))) paths.push(lookup.files[i].path); });
  return paths;
}

const kindRank = kind => TYPE_KINDS.has(kind) ? (kind === 'alias' || kind === 'delegate' ? 1 : 0) : kind === 'function' || kind === 'variable' || kind === 'enumerator' ? 1 : kind === 'macro' ? 2 : 3;
// Symbols owned by the scope around the click (same class, then enclosing namespaces) rank first.
const proximity = (scope, context) => scope && context && (context === scope || context.startsWith(scope + '::')) ? scope.split('::').length : 0;
const sharedPrefix = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i).split('/').length; };

/**
 * Symbol search. exact: whole-name match; kind: 'definition' | 'declaration' | 'type';
 * scope: preferred owner (Class or Ns::Class); context: scope chain at the click; near: current file path for ranking;
 * within: optional relative folders/files to search in (filtered before ranking and the limit).
 */
export function findSymbols(lookup, { q = '', exact = false, kind, scope, context = '', near = '', limit = 100, within = [] }) {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const keys = exact ? (lookup.byName.has(query) ? [query] : []) : [...lookup.byName.keys()].filter(k => k.includes(query));
  const hits = [];
  for (const key of keys) {
    const list = lookup.byName.get(key), match = key === query ? 0 : key.startsWith(query) ? 1 : 2;
    for (let i = 0; i < list.length; i += 2) {
      const f = lookup.files[list[i]], s = list[i + 1];
      if (within.length && !inSearchScope(within, f.path)) continue;
      const symbolKind = KINDS[f.symbols[s + 1]];
      if (kind === 'definition' && symbolKind === 'declaration') continue;
      if (kind === 'declaration' && symbolKind !== 'declaration') continue;
      if (kind === 'type' && !TYPE_KINDS.has(symbolKind)) continue;
      hits.push({ name: lookup.names[f.symbols[s]], kind: symbolKind, line: f.symbols[s + 2], scope: lookup.names[f.symbols[s + 3]], path: f.path, match });
    }
  }
  const wanted = scope?.toLowerCase();
  const inScope = wanted ? hits.filter(h => { const own = h.scope.toLowerCase(); return own === wanted || own.endsWith(`::${wanted}`) || wanted.endsWith(`::${own}`); }) : [];
  const pool = inScope.length ? inScope : hits;
  const cased = q.trim();
  pool.sort((a, b) => a.match - b.match || Number(b.name === cased) - Number(a.name === cased) || proximity(b.scope, context) - proximity(a.scope, context) || kindRank(a.kind) - kindRank(b.kind)
    || Number(a.path.includes('ThirdParty/')) - Number(b.path.includes('ThirdParty/')) || sharedPrefix(b.path, near) - sharedPrefix(a.path, near) || a.path.length - b.path.length || a.line - b.line);
  return pool.slice(0, limit).map(({ match, ...h }) => h);
}

export const lookupStats = lookup => ({ files: lookup.files.length, symbols: lookup.files.reduce((n, f) => n + f.symbols.length / 4, 0), tokens: lookup.tokens.length });
