// On-disk code index: <dir>/meta.json (written last, acts as the commit marker),
// strings.json (symbol names/scopes and search tokens), files.ndjson (one line per source file).
// A file line: [path, size, mtimeMs, [nameId, kind, line, scopeId, ...], tokenIdsBase64].
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

// 2: variables, enumerators and full namespace scopes.
export const INDEX_VERSION = 2;

// Sorted ids → delta varints → base64. Keeps ~60k files' token lists to a few tens of MB.
export function encodeIds(ids) {
  const sorted = Uint32Array.from(ids).sort(), bytes = [];
  let previous = 0;
  for (const id of sorted) { let v = id - previous; previous = id; while (v >= 0x80) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; } bytes.push(v); }
  return Buffer.from(bytes).toString('base64');
}
export function decodeIds(text) {
  const bytes = Buffer.from(text, 'base64'), ids = [];
  let value = 0, shift = 0, previous = 0;
  for (const b of bytes) { value |= (b & 0x7f) << shift; if (b & 0x80) { shift += 7; continue; } previous += value >>> 0; ids.push(previous); value = 0; shift = 0; }
  return Uint32Array.from(ids);
}

export async function saveIndex(dir, { root, builtAt, names, tokens, files }) {
  const temp = `${dir}.tmp`;
  await fs.rm(temp, { recursive: true, force: true }); await fs.mkdir(temp, { recursive: true });
  await fs.writeFile(path.join(temp, 'strings.json'), JSON.stringify({ names, tokens }));
  await new Promise((resolve, reject) => {
    const out = createWriteStream(path.join(temp, 'files.ndjson'), 'utf8');
    out.on('error', reject); out.on('finish', resolve);
    for (const f of files) out.write(JSON.stringify([f.path, f.size, f.mtime, Array.from(f.symbols), encodeIds(f.tokens)]) + '\n');
    out.end();
  });
  const symbols = files.reduce((n, f) => n + f.symbols.length / 4, 0);
  await fs.writeFile(path.join(temp, 'meta.json'), JSON.stringify({ version: INDEX_VERSION, root, builtAt, files: files.length, symbols, tokens: tokens.length }));
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rename(temp, dir);
}

/** Returns null when absent, from another version or for another root. */
export async function loadIndex(dir, root) {
  let meta;
  try { meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')); } catch { return null; }
  if (meta.version !== INDEX_VERSION || meta.root !== root) return null;
  const { names, tokens } = JSON.parse(await fs.readFile(path.join(dir, 'strings.json'), 'utf8'));
  const files = [];
  const lines = readline.createInterface({ input: createReadStream(path.join(dir, 'files.ndjson'), 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const [p, size, mtime, symbols, tokenIds] = JSON.parse(line);
    files.push({ path: p, size, mtime, symbols: Int32Array.from(symbols), tokens: decodeIds(tokenIds) });
  }
  return { meta, names, tokens, files };
}
