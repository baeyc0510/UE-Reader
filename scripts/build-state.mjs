import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function files(relative) {
  const absolute = path.join(root, relative), stat = await fs.stat(absolute);
  if (!stat.isDirectory()) return [relative];
  return (await Promise.all((await fs.readdir(absolute)).sort().map(name => files(path.join(relative, name))))).flat();
}
const digest = createHash('sha256');
for (const input of ['src', 'public', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts']) {
  for (const file of await files(input)) { digest.update(file); digest.update(await fs.readFile(path.join(root, file))); }
}
const hash = digest.digest('hex'), stamp = path.join(root, '.runtime', 'build.sha256');
if (process.argv.includes('--save')) {
  await fs.mkdir(path.dirname(stamp), { recursive: true }); await fs.writeFile(stamp, hash);
} else {
  try { await fs.access(path.join(root, 'dist', 'index.html')); process.exitCode = (await fs.readFile(stamp, 'utf8')) === hash ? 0 : 1; }
  catch { process.exitCode = 1; }
}
