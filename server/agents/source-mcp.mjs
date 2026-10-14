// Dedicated read-only MCP process. Only the manifest's source root is accessible.
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createSourceTools, sourceToolDefinitions } from './source-tools.mjs';
import { remoteIndex } from './index-client.mjs';

// stdout is the JSON-RPC channel; libraries such as pdf.js log warnings with console.log.
console.log = console.info = console.warn = console.debug = (...args) => console.error(...args);
const manifest = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
let turnId, call;
async function scopedCall(name, args) {
  const current = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  if (JSON.stringify(current.root) !== JSON.stringify(manifest.root)) throw Error('작업공간이 변경되었습니다. 세션을 다시 시작하세요.');
  if (!call || turnId !== current.turnId) {
    turnId = current.turnId;
    const audit = path.join(current.auditDirectory || path.dirname(process.argv[2]), 'source-reads.jsonl');
    // The app's file and code indexes (granted per request) replace walking and scanning the folders here.
    call = createSourceTools(manifest.root, { onRead: context => fs.appendFile(audit, JSON.stringify(context) + '\n', 'utf8'), limits: manifest.limits, searchScope: current.searchScope, codeIndex: remoteIndex(current.indexAccess) });
  }
  return call(name, args);
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
input.on('line', async line => {
  let request;
  try { request = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); }
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ue-reader-source', version: '1.0.0' } };
  else if (request.method === 'ping') result = {};
  else if (request.method === 'tools/list') result = { tools: sourceToolDefinitions };
  else if (request.method === 'tools/call') {
    try { result = { content: [{ type: 'text', text: JSON.stringify(await scopedCall(request.params?.name, request.params?.arguments)) }] }; }
    catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
  } else return send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
  send({ jsonrpc: '2.0', id: request.id, result });
});
