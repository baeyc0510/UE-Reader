// Single JSON document (reader.json) with serialized, atomic (temp + rename) updates.
import fs from 'node:fs/promises';
import path from 'node:path';
import { emptyData, migrate } from './migrations.mjs';

export class Store {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'reader.json'); this.queue = Promise.resolve(); }
  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    try { this.data = migrate(JSON.parse(await fs.readFile(this.file, 'utf8'))); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error(`앱 데이터를 읽을 수 없습니다. 원본을 보존했습니다: ${this.file}`); this.data = emptyData(); }
    return this;
  }
  update(mutate) {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.data);
      const result = await mutate(next);
      const temp = this.file + '.tmp';
      await fs.writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
      await fs.rename(temp, this.file);
      this.data = next;
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
