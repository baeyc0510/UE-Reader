import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { createSourceTools } from '../server/agents/source-tools.mjs';
import { analysisInstructions } from '../server/analysis/prompts.mjs';
import { sourceScope } from '../server/source/source.mjs';

// Smallest valid PDF with one text line per page.
function pdf(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  pages.forEach((text, i) => {
    const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let body = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

async function fixture(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ue-reader-docs-'));
  const engine = path.join(base, 'Engine'), game = path.join(base, 'ProjectR');
  await fs.mkdir(engine, { recursive: true }); await fs.mkdir(path.join(game, 'Source'), { recursive: true });
  await fs.writeFile(path.join(engine, 'Actor.h'), 'class AActor {};\n');
  await fs.writeFile(path.join(game, 'Source', 'MyPawn.cpp'), 'class AMyPawn {};\n');
  await fs.writeFile(path.join(game, 'Design Doc.pdf'), pdf(['Weapon fire uses client prediction', 'AI tick budget']));
  await fs.writeFile(path.join(game, 'README.md'), '# ProjectR\n\nCo-op shooter.\n');
  const service = await createApp({ codeIndex: false, dataDir: path.join(base, 'data'), statusProvider: async () => ({ available: true, authenticated: true }), modelProvider: async () => [{ id: 'test-model', displayName: 'Test', isDefault: true }], modelVersionProvider: async () => 'v1', ...options });
  const server = service.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (route, method = 'GET', body) => { const r = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json() }; };
  const uploadFile = async (name, bytes) => { const r = await fetch(url + '/attachments', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) }, body: bytes }); return { status: r.status, data: await r.json() }; };
  t.after(async () => { for (const j of service.jobs.values()) j.controller.abort(); service.agents.close(); await service.codeIndexes.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const { data: w } = await request('/workspaces', 'POST', { root: engine });
  await request(`/workspaces/${w.id}/folders`, 'POST', { path: game });
  return { ...service, base, engine, game, w: service.store.data.workspaces.find(x => x.id === w.id), request, uploadFile };
}
async function waitJob(request, id) { for (let i = 0; i < 300; i++) { const { data } = await request(`/jobs/${id}`); if (data.status !== 'running') return data; await new Promise(r => setTimeout(r, 10)); } throw Error('Job timeout'); }

test('agents find and read workspace documents (PDF text, Markdown) without treating them as code evidence', async t => {
  const f = await fixture(t), read = [];
  const tools = createSourceTools(sourceScope(f.w), { onRead: c => { read.push(c.path); } });
  assert.deepEqual((await tools('search_documents', { query: '' })).documents, ['ProjectR/Design Doc.pdf', 'ProjectR/README.md']);
  assert.ok(!(await tools('search_files', { query: '' })).files.some(file => file.endsWith('.pdf')), 'documents stay out of the code file list');
  const doc = await tools('read_document', { path: 'ProjectR/Design Doc.pdf' });
  assert.equal(doc.pages, 2); assert.match(doc.content, /\[페이지 1\][\s\S]*client prediction[\s\S]*\[페이지 2\][\s\S]*AI tick budget/);
  // Users quote absolute paths; inside a workspace folder they resolve to the scoped path.
  assert.equal((await tools('read_document', { path: path.join(f.game, 'README.md'), start: 1, end: 1 })).path, 'ProjectR/README.md');
  assert.equal((await tools('read_file', { path: path.join(f.game, 'Source', 'MyPawn.cpp') })).path, 'ProjectR/Source/MyPawn.cpp');
  await assert.rejects(tools('read_file', { path: 'ProjectR/Design Doc.pdf' }), /read_document/);
  await assert.rejects(tools('read_document', { path: 'ProjectR/../../outside.md' }), /허용되지/);
  await assert.rejects(tools('read_document', { path: path.join(f.base, 'elsewhere.md') }), /상대 소스 경로/);
  assert.deepEqual(read, ['ProjectR/Source/MyPawn.cpp'], 'only code reads are audited as inspected ranges');
  // The explorer list is unchanged.
  let files; for (let i = 0; i < 100; i++) { const { data } = await f.request(`/workspaces/${f.w.id}/files?all=1`); if (data.status === 'ready') { files = data.files; break; } await new Promise(r => setTimeout(r, 20)); }
  assert.deepEqual(files, ['Actor.h', 'ProjectR/Source/MyPawn.cpp']);
  assert.match(analysisInstructions({ questionMode: true, workspace: f.w }), /search_documents[\s\S]*read_document/);
});

test('files attached in the chat composer are extracted on upload and sent with the question', async t => {
  let prompt = '';
  const f = await fixture(t, { runner: async options => { prompt = options.prompt; return { title: '첨부 질문', summary: '답변', suggestedFiles: [], webSources: [], diagrams: [] }; } });
  const outside = path.join(f.base, 'outside');
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'notes.txt'), 'Replication notes: server authority.\n');
  const attachedPdf = await f.uploadFile('기획서.pdf', pdf(['Boss pattern three phases']));
  assert.equal(attachedPdf.status, 200); assert.equal(attachedPdf.data.name, '기획서.pdf'); assert.equal(attachedPdf.data.pages, 1); assert.ok(!('text' in attachedPdf.data));
  const attachedText = await f.uploadFile('notes.txt', await fs.readFile(path.join(outside, 'notes.txt')));
  assert.equal(attachedText.data.pages, 0);
  assert.equal((await f.uploadFile('image.bin', Buffer.from([0, 1, 2, 0, 255]))).status, 400);
  assert.equal((await f.uploadFile('broken.pdf', Buffer.from('%PDF-1.4 nothing'))).status, 400);
  const started = await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: '보스 패턴은?', attachments: [attachedPdf.data.id, attachedText.data.id] });
  assert.equal(started.status, 202);
  assert.equal((await waitJob(f.request, started.data.id)).status, 'complete');
  assert.match(prompt, /<<<첨부 파일: 기획서\.pdf · 1쪽>>>[\s\S]*Boss pattern three phases/);
  assert.match(prompt, /Replication notes: server authority/);
  const [conversation] = (await f.request(`/workspaces/${f.w.id}/conversations?chatId=${started.data.chatId}`)).data;
  assert.deepEqual(conversation.attachedFiles.map(x => x.name), ['기획서.pdf', 'notes.txt']);
  assert.equal((await f.request(`/workspaces/${f.w.id}/generate`, 'POST', { kind: 'question', question: '없는 첨부', attachments: ['missing'] })).status, 400);
});
