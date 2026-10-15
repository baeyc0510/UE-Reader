// Single JSON document (reader.json) with serialized, atomic (temp + rename) updates.
// defer() is for frequent, low-stakes changes (screen state): applied in order right away but
// written with the next update or after a quiet period. flush() writes them; shutdown awaits it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { emptyData, migrate } from './migrations.mjs';

const DEFER_MS = 2000;

export class Store {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'reader.json'); this.queue = Promise.resolve(); this.version = 0; this.written = 0; }
  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    try { this.data = migrate(JSON.parse(await fs.readFile(this.file, 'utf8'))); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error(`앱 데이터를 읽을 수 없습니다. 원본을 보존했습니다: ${this.file}`); this.data = emptyData(); }
    return this;
  }
  enqueue(work) { const operation = this.queue.then(work); this.queue = operation.catch(() => {}); return operation; }
  async write(data) {
    const temp = this.file + '.tmp';
    await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(temp, this.file);
    this.written = this.version;
  }
  update(mutate) {
    return this.enqueue(async () => {
      const next = structuredClone(this.data);
      const result = await mutate(next);
      await this.write(next);
      this.data = next;
      return result;
    });
  }
  // Rewriting a large reader.json blocks the process (in the desktop app, the one delivering input),
  // so screen state is not written on every change.
  defer(mutate) {
    clearTimeout(this.timer); this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, DEFER_MS); this.timer.unref?.();
    return this.enqueue(() => { mutate(this.data); this.version++; });
  }
  flush() { clearTimeout(this.timer); return this.enqueue(() => this.version !== this.written ? this.write(this.data) : undefined); }
}
