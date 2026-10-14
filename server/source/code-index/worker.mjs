// Worker thread owning one workspace's code index: loads the saved index, refreshes changed
// files (size/mtime), saves, and answers symbol and search-candidate queries off the main thread.
import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { walkScope, locateInScope, sourceScope, decodeSource, MAX_SOURCE_BYTES } from '../source.mjs';
import { extractSymbols, extractTokens } from './cpp-symbols.mjs';
import { loadIndex, saveIndex } from './store.mjs';
import { createTables, packFile, buildLookup, candidateFiles, findSymbols, lookupStats } from './query.mjs';

// scope: the main root plus mounted folders. The saved index belongs to the main root, so adding or
// removing a folder only parses the difference.
const { scope, dir } = workerData, { root } = sourceScope(scope);
let data = null, lookup = null, busy = null, queued = null;
let status = { status: 'loading', processed: 0, total: 0, parsed: 0, files: 0, symbols: 0, tokens: 0, builtAt: null, error: '' };
const post = patch => { status = { ...status, ...patch, ...(lookup ? lookupStats(lookup) : {}) }; parentPort.postMessage({ type: 'status', status }); };

async function walk() {
  const found = [];
  await walkScope(scope, async (relative, absolute) => {
    try { const stat = await fs.stat(absolute); found.push({ path: relative, size: stat.size, mtime: Math.trunc(stat.mtimeMs) }); } catch {}
  }, { concurrency: 16 });
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

async function parse(file) {
  if (file.size > MAX_SOURCE_BYTES) return { ...file, symbols: [], tokens: [] };
  const { base, rest } = locateInScope(scope, file.path);
  const text = decodeSource(await fs.readFile(path.join(base, rest)).catch(() => Buffer.alloc(0))) || '';
  return { ...file, symbols: extractSymbols(text), tokens: extractTokens(text) };
}

async function update(full) {
  post({ status: lookup ? 'updating' : 'building', processed: 0, total: 0, parsed: 0, error: '' });
  const listed = await walk();
  if (!full && data && listed.length === data.files.length) {
    const known = new Map(data.files.map(f => [f.path, f]));
    if (listed.every(f => { const old = known.get(f.path); return old && old.size === f.size && old.mtime === f.mtime; })) return post({ status: 'ready', processed: listed.length, total: listed.length, parsed: 0 });
  }
  // A full rebuild starts fresh tables so stale names and tokens disappear.
  const tables = full || !data ? createTables() : createTables(data.names, data.tokens);
  const previous = new Map(full || !data ? [] : data.files.map(f => [f.path, f]));
  const files = []; let processed = 0, parsed = 0, lastPost = 0;
  post({ total: listed.length });
  for (let i = 0; i < listed.length; i += 32) {
    const batch = listed.slice(i, i + 32);
    const reads = await Promise.all(batch.map(f => { const old = previous.get(f.path); return old && old.size === f.size && old.mtime === f.mtime ? old : parse(f); }));
    for (const r of reads) {
      if (r.symbols instanceof Int32Array) files.push(r);
      else { files.push(packFile(tables, r)); parsed++; }
      processed++;
    }
    if (Date.now() - lastPost > 500) { lastPost = Date.now(); post({ processed, parsed }); }
  }
  const changed = parsed > 0 || files.length !== (data?.files.length ?? -1);
  data = { names: tables.names, tokens: tables.tokens, files };
  lookup = buildLookup(data);
  const builtAt = changed || !status.builtAt ? new Date().toISOString() : status.builtAt;
  if (changed) await saveIndex(dir, { root, builtAt, ...data });
  post({ status: 'ready', processed, parsed, builtAt });
}

async function run(full) {
  if (busy) { queued = queued || full ? true : false; return busy; }
  busy = update(full).catch(error => post({ status: lookup ? 'ready' : 'error', error: error.message }))
    .finally(() => { busy = null; if (queued !== null) { const next = queued; queued = null; void run(next); } });
  return busy;
}

parentPort.on('message', message => {
  if (message.type === 'update') { void run(!!message.full); return; }
  if (message.type !== 'query') return;
  try {
    const result = !lookup ? null : message.op === 'symbols' ? findSymbols(lookup, message.args) : message.op === 'candidates' ? candidateFiles(lookup, message.args.q, message.args.within) : null;
    parentPort.postMessage({ type: 'reply', id: message.id, result });
  } catch (error) { parentPort.postMessage({ type: 'reply', id: message.id, error: error.message }); }
});

// Reuse the saved index immediately, then refresh only files whose size or mtime changed.
(async () => {
  try {
    const saved = await loadIndex(dir, root);
    if (saved) { data = saved; lookup = buildLookup(data); post({ status: 'ready', builtAt: saved.meta.builtAt, total: saved.files.length, processed: saved.files.length }); }
  } catch (error) { post({ error: `저장된 인덱스를 읽지 못해 다시 만듭니다. ${error.message}` }); }
  await run(false);
})();
