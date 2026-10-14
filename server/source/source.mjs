import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const extensions = new Set(['.h', '.hpp', '.cpp', '.cc', '.c', '.inl', '.cs', '.usf', '.ush']);
// Reference documents agents may read (documents.mjs). They never become code evidence or explorer entries.
export const documentExtensions = new Set(['.pdf', '.md', '.markdown', '.txt', '.rst', '.csv', '.json', '.ini', '.yaml', '.yml', '.uproject', '.uplugin']);
const ignored = new Set(['.git', 'node_modules', 'Binaries', 'Intermediate', 'DerivedDataCache', 'Saved', '.vs']);
export const hash = text => createHash('sha256').update(text).digest('hex');
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
// Source scope: the workspace root plus extra folders mounted under their own top-level name
// ("MyGame/Source/..."), so one workspace can read e.g. the engine and a game project. A plain
// string (or a workspace record) works wherever a scope is expected. Paths in the main root stay
// unprefixed, so adding folders never changes existing explanations.
export function sourceScope(value) {
  if (!value || typeof value === 'string') return { root: value || '', folders: [] };
  return { root: value.root || '', folders: (Array.isArray(value.folders) ? value.folders : []).map(({ name, path }) => ({ name, path })) };
}
export const scopeKey = value => JSON.stringify(sourceScope(value));
export const scopeBases = value => { const s = sourceScope(value); return [{ base: s.root, prefix: '' }, ...s.folders.map(f => ({ base: f.path, prefix: `${f.name}/` }))]; };
// Top-level names reserved by mounted folders are skipped in the main root to keep paths unambiguous.
export const mountedNames = value => new Set(sourceScope(value).folders.map(f => f.name.toLowerCase()));
/** Which folder a relative path belongs to: { base, rest, prefix }. */
export function locateInScope(value, relative) {
  const s = sourceScope(value), first = relative.split(/[\\/]/)[0], folder = s.folders.find(f => f.name.toLowerCase() === first.toLowerCase());
  return folder ? { base: folder.path, rest: relative.slice(first.length + 1), prefix: `${folder.name}/` } : { base: s.root, rest: relative, prefix: '' };
}
/** Agents often quote absolute paths from the user; map one inside a scope folder to its scope path. */
export function toScopePath(value, file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return file;
  for (const { base, prefix } of scopeBases(value)) if (base && inside(base, path.resolve(file)) && path.resolve(file) !== path.resolve(base)) return prefix + path.relative(base, path.resolve(file)).replaceAll('\\', '/');
  return file;
}
// Agent search scope: workspace folders or files the search tools look in by default ([] = everything).
export async function searchScopePaths(scope, list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > 20) throw fail('검색 범위는 최대 20개 경로까지 지정하세요.');
  const paths = [];
  for (const value of list) {
    const relative = typeof value === 'string' ? value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '') : '';
    if (!relative || relative.includes('\0') || path.isAbsolute(relative) || relative.split('/').includes('..')) throw fail('검색 범위의 경로를 확인하세요.');
    const { base, rest } = locateInScope(scope, relative), target = base && path.resolve(base, rest || '.');
    if (!target || !inside(base, target) || !(await fs.stat(target).catch(() => null))) throw fail(`검색 범위의 경로를 찾을 수 없습니다: ${relative}`);
    if (!paths.some(p => p.toLowerCase() === relative.toLowerCase())) paths.push(relative);
  }
  return paths;
}
export const inSearchScope = (paths, file) => { const f = file.toLowerCase(); return paths.some(p => { const s = p.toLowerCase(); return f === s || f.startsWith(`${s}/`); }); };
export async function resolveSource(scope, relative, allowed = extensions) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative)) throw fail('상대 소스 경로가 필요합니다.');
  const { base: root, rest } = locateInScope(scope, relative);
  if (!root || !rest) throw fail('허용되지 않은 소스 경로입니다.', 403);
  const candidate = path.resolve(root, rest);
  if (!inside(root, candidate) || !allowed.has(path.extname(candidate).toLowerCase())) throw fail('허용되지 않은 소스 경로입니다.', 403);
  let actual;
  try { actual = await fs.realpath(candidate); } catch { throw fail('소스 파일을 찾을 수 없습니다. 폴더 경로를 확인하세요.', 404); }
  if (!inside(await fs.realpath(root), actual)) throw fail('작업공간 밖의 링크는 읽을 수 없습니다.', 403);
  return actual;
}
// UTF-8 or UTF-16 LE (BOM), LF line endings. Binary content returns null.
export function decodeSource(buffer) {
  const text = (buffer[0] === 255 && buffer[1] === 254 ? buffer.toString('utf16le') : buffer.toString('utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  return text.includes('\0') ? null : text;
}
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const ignoredFolders = ignored;
export async function readSource(root, relative) {
  const file = await resolveSource(root, relative), { rest, prefix } = locateInScope(root, relative);
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) throw fail('12MB 이하의 소스 파일만 열 수 있습니다.');
  const text = decodeSource(await fs.readFile(file));
  if (text === null) throw fail('텍스트 소스 파일이 아닙니다.');
  return { path: (prefix + rest).replaceAll('\\', '/'), text, hash: hash(text), lines: text.split('\n').length };
}
export function locateNote(note, source) {
  if (note.hash === source.hash) return { ...note, sourceState: 'same' };
  if (!note.snapshot) return { ...note, sourceState: 'changed' };
  const lines = source.text.split('\n');
  const snapshotLines = note.snapshot.split('\n');
  const count = snapshotLines.length;
  const matches = [];
  for (let i = 0; i <= lines.length - count; i++) {
    if (lines[i] === snapshotLines[0] && lines.slice(i, i + count).join('\n') === note.snapshot) matches.push(i + 1);
    if (matches.length > 1) break;
  }
  return matches.length === 1 ? { ...note, start: matches[0], end: matches[0] + count - 1, details: note.details?.map(d => ({ ...d, start: d.start + matches[0] - note.start, end: d.end + matches[0] - note.start })), sourceState: 'moved' } : { ...note, sourceState: 'changed' };
}
/** Walks every folder of a scope (metadata only) and calls onFile(relativePath, absolutePath) per source file, onDocument(relativePath) per document. */
export async function walkScope(scope, onFile, { cancelled = () => false, onSkip = () => {}, onDocument, concurrency = 12 } = {}) {
  const reserved = mountedNames(scope);
  const pending = scopeBases(scope).filter(b => b.base).map(b => ({ dir: b.base, ...b }));
  async function walk({ dir, base, prefix }) {
    if (cancelled()) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { onSkip(); return; }
    for (const entry of entries) {
      if (cancelled()) return;
      if (entry.isSymbolicLink() || (!prefix && dir === base && reserved.has(entry.name.toLowerCase()))) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory() && !ignored.has(entry.name)) pending.push({ dir: abs, base, prefix });
      else if (!entry.isFile()) continue;
      else if (extensions.has(path.extname(entry.name).toLowerCase())) await onFile(prefix + path.relative(base, abs).replaceAll('\\', '/'), abs);
      else if (onDocument && documentExtensions.has(path.extname(entry.name).toLowerCase())) onDocument(prefix + path.relative(base, abs).replaceAll('\\', '/'));
    }
  }
  while (pending.length && !cancelled()) await Promise.all(pending.splice(0, concurrency).map(walk));
}
export function makeIndex(scope) {
  const index = { id: randomUUID(), files: [], documents: [], status: 'indexing', skipped: 0, cancel: false };
  index.done = (async () => {
    await walkScope(scope, file => { index.files.push(file); }, { cancelled: () => index.cancel, onSkip: () => { index.skipped++; }, onDocument: file => { index.documents.push(file); } });
    index.files.sort((a, b) => a.localeCompare(b)); index.documents.sort((a, b) => a.localeCompare(b));
    index.status = index.cancel ? 'cancelled' : 'ready';
  })();
  return index;
}
export async function engineVersion(root) {
  for (const relative of ['Engine/Build/Build.version', 'Build/Build.version']) {
    try {
      const file = await fs.realpath(path.join(root, relative));
      if (!inside(root, file)) continue;
      const version = JSON.parse(await fs.readFile(file, 'utf8'));
      return `${version.MajorVersion}.${version.MinorVersion}.${version.PatchVersion}`;
    } catch { /* A source-only checkout may have no version. */ }
  }
  return '미확인';
}
