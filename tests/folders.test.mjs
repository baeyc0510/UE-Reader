import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { createSourceTools } from '../server/agents/source-tools.mjs';
import { remoteIndex } from '../server/agents/index-client.mjs';
import { analysisInstructions, buildRequestPrompt } from '../server/analysis/prompts.mjs';
import { sourceScope } from '../server/source/source.mjs';

// Engine-like main folder plus a game project mounted as "MyGame/".
async function fixture(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ue-reader-folders-'));
  const engine = path.join(base, 'Engine', 'Source'), game = path.join(base, 'MyGame');
  await fs.mkdir(path.join(engine, 'Runtime'), { recursive: true }); await fs.mkdir(path.join(game, 'Source'), { recursive: true });
  await fs.writeFile(path.join(engine, 'Runtime', 'Actor.h'), 'class AActor\n{\n  virtual void Tick(float DeltaSeconds);\n};\n');
  await fs.writeFile(path.join(game, 'Source', 'MyPawn.cpp'), '#include "Actor.h"\nclass AMyPawn : public AActor\n{\n  void Tick(float DeltaSeconds) override;\n};\n');
  const service = await createApp({ dataDir: path.join(base, 'data'), statusProvider: async () => ({ available: true, authenticated: true }), ...options });
  const server = service.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (route, method = 'GET', body) => { const r = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json() }; };
  t.after(async () => { service.agents.close(); await service.codeIndexes.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const { data: w } = await request('/workspaces', 'POST', { root: engine });
  return { ...service, base, engine, game, w, request };
}
const files = async f => { for (let i = 0; i < 100; i++) { const { data } = await f.request(`/workspaces/${f.w.id}/files?all=1`); if (data.status === 'ready') return data.files; await new Promise(r => setTimeout(r, 20)); } throw Error('index timeout'); };

test('a workspace mounts extra folders under their own name; files, search, code index and agent tools see both', async t => {
  const f = await fixture(t);
  assert.equal((await f.request(`/workspaces/${f.w.id}/folders`, 'POST', { path: path.join(f.engine, 'Runtime') })).status, 400, 'overlapping folder');
  assert.equal((await f.request(`/workspaces/${f.w.id}/folders`, 'POST', { path: f.game, name: 'Runtime' })).status, 400, 'name shadows a main-folder entry');
  const added = await f.request(`/workspaces/${f.w.id}/folders`, 'POST', { path: f.game });
  assert.deepEqual(added.data.folders.map(x => x.name), ['MyGame']);
  assert.equal((await f.request(`/workspaces/${f.w.id}/folders`, 'POST', { path: f.game, name: 'mygame' })).status, 400, 'duplicate name');
  assert.deepEqual(await files(f), ['MyGame/Source/MyPawn.cpp', 'Runtime/Actor.h']);
  const file = await f.request(`/workspaces/${f.w.id}/file?path=${encodeURIComponent('MyGame/Source/MyPawn.cpp')}`);
  assert.equal(file.data.source.path, 'MyGame/Source/MyPawn.cpp'); assert.match(file.data.source.text, /AMyPawn/);
  assert.equal((await f.request(`/workspaces/${f.w.id}/file?path=${encodeURIComponent('MyGame/../../x.cpp')}`)).status, 403);
  const search = await f.request(`/workspaces/${f.w.id}/search?q=DeltaSeconds`);
  assert.deepEqual([...new Set(search.data.results.map(r => r.path))].sort(), ['MyGame/Source/MyPawn.cpp', 'Runtime/Actor.h']);
  // Symbols of both folders.
  let symbols;
  for (let i = 0; i < 200; i++) { symbols = await f.request(`/workspaces/${f.w.id}/symbols?q=AMyPawn&exact=1`); if (symbols.data.results?.length) break; await new Promise(r => setTimeout(r, 25)); }
  assert.equal(symbols.data.results[0].path, 'MyGame/Source/MyPawn.cpp');
  // Agent tools and instructions.
  const w = f.store.data.workspaces.find(x => x.id === f.w.id), read = [];
  const tools = createSourceTools(sourceScope(w), { onRead: c => { read.push(c.path); } });
  assert.ok((await tools('search_files', { query: 'MyPawn' })).files.includes('MyGame/Source/MyPawn.cpp'));
  assert.match((await tools('read_file', { path: 'MyGame/Source/MyPawn.cpp', start: 1, end: 3 })).content, /AMyPawn/);
  assert.deepEqual(read, ['MyGame/Source/MyPawn.cpp']);
  assert.match(analysisInstructions({ questionMode: true, workspace: w }), /"MyGame\/"/);
  // Removing the folder hides its files; re-adding brings them back under the same name.
  assert.deepEqual((await f.request(`/workspaces/${f.w.id}/folders/MyGame`, 'DELETE')).data.folders, []);
  assert.deepEqual(await files(f), ['Runtime/Actor.h']);
  assert.equal((await f.request(`/workspaces/${f.w.id}/file?path=${encodeURIComponent('MyGame/Source/MyPawn.cpp')}`)).status, 404);
});

test('a search scope limits the agent search tools to chosen folders or files unless wholeWorkspace is set', async t => {
  let seen;
  const f = await fixture(t, { runner: async args => { seen = { searchScope: args.searchScope, prompt: args.prompt, files: (await args.sourceTools('search_files', { query: '' })).files, whole: (await args.sourceTools('search_files', { query: '', wholeWorkspace: true })).files, code: (await args.sourceTools('search_code', { query: 'DeltaSeconds' })).results.map(r => r.path) }; return { title: 't', summary: 's', suggestedFiles: [], webSources: [], diagrams: [] }; } });
  await f.request(`/workspaces/${f.w.id}/folders`, 'POST', { path: f.game });
  await files(f);
  assert.equal((await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: 'q', searchScope: ['MyGame/Missing'] })).status, 400);
  assert.equal((await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: 'q', searchScope: ['../Engine'] })).status, 400);
  const job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: 'q', searchScope: ['MyGame\\', 'mygame'] });
  assert.equal(job.status, 202);
  for (let i = 0; i < 200 && !seen; i++) await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(seen.searchScope, ['MyGame']);
  assert.deepEqual(seen.files, ['MyGame/Source/MyPawn.cpp']); assert.deepEqual(seen.whole, ['MyGame/Source/MyPawn.cpp', 'Runtime/Actor.h']);
  assert.deepEqual(seen.code, ['MyGame/Source/MyPawn.cpp']); assert.match(seen.prompt, /Search scope chosen by the user: "MyGame"/);
  // A single file works as a scope; read_file is never limited.
  const w = f.store.data.workspaces.find(x => x.id === f.w.id);
  const tools = createSourceTools(sourceScope(w), { searchScope: ['Runtime/Actor.h'] });
  assert.deepEqual((await tools('search_code', { query: 'Tick' })).results.map(r => r.path), ['Runtime/Actor.h']);
  assert.match((await tools('read_file', { path: 'MyGame/Source/MyPawn.cpp', start: 1, end: 2 })).content, /include/);
  assert.doesNotMatch(buildRequestPrompt({ question: 'q', history: [], context: [] }), /Search scope/);
  // Let the request finish saving; removing the data folder under a running job can hang on Windows.
  for (let i = 0; i < 200 && (await f.request(`/jobs/${job.data.id}`)).data.status === 'running'; i++) await new Promise(r => setTimeout(r, 25));
});

test('agents choose their own search scope: folder layout, code index symbols and indexed code search over the bridge', async t => {
  let seen;
  const f = await fixture(t, { runner: async args => {
    // Built exactly like the MCP process does, through the per-request bridge token.
    const tools = createSourceTools(args.sourceRoot, { codeIndex: remoteIndex(args.indexAccess) });
    seen = { access: args.indexAccess, top: await tools('list_folders', {}), game: await tools('list_folders', { path: 'MyGame', depth: 2 }),
      symbol: await tools('find_symbol', { name: 'AMyPawn' }), scoped: await tools('find_symbol', { name: 'Tick', within: ['Runtime'] }),
      qualified: await tools('find_symbol', { name: 'AMyPawn::Tick' }), code: await tools('search_code', { query: 'DeltaSeconds', within: ['MyGame/Source'] }),
      unknown: await tools('search_files', { query: '', within: ['Nope'] }), inProcess: await args.sourceTools('find_symbol', { name: 'AActor' }) };
    return { title: 't', summary: 's', suggestedFiles: [], webSources: [], diagrams: [] };
  } });
  await f.request(`/workspaces/${f.w.id}/folders`, 'POST', { path: f.game });
  await files(f);
  for (let i = 0; i < 200; i++) { const r = await f.request(`/workspaces/${f.w.id}/symbols?q=AMyPawn&exact=1`); if (r.data.results?.length) break; await new Promise(r => setTimeout(r, 25)); }
  const job = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: 'Tick은 어디서 정의되나요?' });
  let done; for (let i = 0; i < 200; i++) { done = (await f.request(`/jobs/${job.data.id}`)).data; if (done.status !== 'running') break; await new Promise(r => setTimeout(r, 25)); }
  assert.equal(done.status, 'complete', done.error);
  assert.deepEqual(seen.top.folders, [{ path: 'MyGame', files: 1 }, { path: 'Runtime', files: 1 }]);
  assert.deepEqual(seen.game.folders, [{ path: 'MyGame/Source', files: 1 }]);
  assert.equal(seen.symbol.symbols[0].path, 'MyGame/Source/MyPawn.cpp'); assert.match(seen.symbol.symbols[0].text, /class AMyPawn/);
  assert.ok(seen.scoped.symbols.length && seen.scoped.symbols.every(s => s.path === 'Runtime/Actor.h')); assert.deepEqual(seen.scoped.searchedIn, ['Runtime']);
  assert.equal(seen.qualified.symbols[0].path, 'MyGame/Source/MyPawn.cpp');
  assert.equal(seen.code.usedCodeIndex, true); assert.deepEqual(seen.code.results.map(r => r.path), ['MyGame/Source/MyPawn.cpp']); assert.equal(seen.code.scanned, 1);
  assert.deepEqual(seen.unknown.unknownScope, ['Nope']);
  assert.equal(seen.inProcess.symbols[0].path, 'Runtime/Actor.h');
  // The token only lives as long as its request.
  const bridge = token => fetch(seen.access.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UE-Reader-Agent-Token': token }, body: JSON.stringify({ op: 'files' }) });
  assert.equal((await bridge(seen.access.token)).status, 403); assert.equal((await bridge('')).status, 403);
  // Without the bridge the tools still work by walking and scanning; find_symbol explains the fallback.
  const plain = createSourceTools(sourceScope(f.store.data.workspaces.find(x => x.id === f.w.id)));
  assert.deepEqual((await plain('search_code', { query: 'DeltaSeconds', within: ['Runtime'] })).results.map(r => r.path), ['Runtime/Actor.h']);
  await assert.rejects(plain('find_symbol', { name: 'AActor' }), /search_code/);
  const guide = analysisInstructions({ questionMode: true, workspace: f.store.data.workspaces.find(x => x.id === f.w.id) });
  assert.match(guide, /deciding where to look before searching/); assert.match(guide, /Use find_symbol first/); assert.match(guide, /widen step by step/);
});
