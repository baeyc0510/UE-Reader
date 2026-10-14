// Literal, case-insensitive code search over a file list. Reads files in parallel batches but
// reports results in list order, so narrowing the list (code index candidates) never reorders output.
import { readSource } from './source.mjs';

export async function searchCode({ root, files, query, limit = 100, timeLimit = 20000, cancelled = () => false, concurrency = 16 }) {
  const q = query.toLowerCase(), results = [], begin = Date.now();
  let scanned = 0, skipped = 0;
  for (let i = 0; i < files.length; i += concurrency) {
    if (cancelled() || results.length >= limit || Date.now() - begin > timeLimit) break;
    const batch = files.slice(i, i + concurrency);
    const sources = await Promise.all(batch.map(relative => readSource(root, relative).catch(() => null)));
    for (const [j, source] of sources.entries()) {
      scanned++;
      if (!source) { skipped++; continue; }
      if (!source.text.toLowerCase().includes(q)) continue;
      source.text.split('\n').some((line, n) => { if (line.toLowerCase().includes(q)) results.push({ path: batch[j], line: n + 1, text: line.trim().slice(0, 240) }); return results.length >= limit; });
      if (results.length >= limit) break;
    }
  }
  return { results, scanned, skipped, exhausted: scanned === files.length && results.length < limit };
}
