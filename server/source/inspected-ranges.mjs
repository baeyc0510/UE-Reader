// Only join excerpts from the same version of a file. Never fill unread gaps.
export const sourceKey = value => {
  if (typeof value !== 'string') return '';
  const relative = value.replaceAll('\\', '/').replace(/^(\.\/)+/, '');
  if (relative.startsWith('/') || relative.includes(':') || relative.split('/').includes('..')) return '';
  return process.platform === 'win32' ? relative.toLowerCase() : relative;
};

export function inspectedRanges(context) {
  const latest = new Map(), groups = new Map();
  for (const c of context) if (sourceKey(c.path)) latest.set(sourceKey(c.path), c.hash);
  for (const c of context) {
    const key = sourceKey(c.path);
    if (!key || !c.hash || c.hash !== latest.get(key)) continue;
    const lines = c.text.split('\n');
    if (!Number.isInteger(c.start) || !Number.isInteger(c.end) || c.start < 1 || c.end < c.start || lines.length !== c.end - c.start + 1) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...c, lines });
  }
  const ranges = new Map();
  for (const [key, excerpts] of groups) {
    const merged = []; let conflict = false;
    for (const c of excerpts.sort((a, b) => a.start - b.start || a.end - b.end)) {
      const last = merged.at(-1);
      if (!last || c.start > last.end + 1) { merged.push({ ...c, lines: [...c.lines] }); continue; }
      for (let n = c.start; n <= Math.min(last.end, c.end); n++) {
        if (last.lines[n - last.start] !== c.lines[n - c.start]) conflict = true;
      }
      if (c.end > last.end) { last.lines.push(...c.lines.slice(last.end - c.start + 1)); last.end = c.end; }
    }
    ranges.set(key, conflict ? [] : merged.map(({ lines, ...c }) => ({ ...c, text: lines.join('\n') })));
  }
  return {
    find: e => Number.isInteger(e?.start) && Number.isInteger(e?.end) && e.start <= e.end
      ? ranges.get(sourceKey(e.path))?.find(c => e.start >= c.start && e.end <= c.end) : undefined,
    describe: file => ranges.get(sourceKey(file))?.map(c => `L${c.start}–${c.end}`).join(', ') || '없음',
  };
}
