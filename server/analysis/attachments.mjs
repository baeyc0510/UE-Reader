// Files the user attaches to a chat question from anywhere on their computer. The client uploads
// the bytes, so the server never opens paths outside the workspace. Extracted text stays in memory
// until the app exits; a question sends it inline (see prompts.mjs#attachedFiles).
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { documentText } from '../source/documents.mjs';
import { fail } from '../source/source.mjs';

export const MAX_ATTACHMENT_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 8, MAX_KEPT = 32, MAX_CHARS = 150000;

export const publicAttachment = ({ text, ...rest }) => rest;

export function createAttachments() {
  const items = new Map();
  return {
    async add(name, buffer) {
      const safe = path.basename(String(name || '').replaceAll('\\', '/')).slice(0, 200) || '첨부 파일';
      if (!buffer?.length) throw fail('빈 파일은 첨부할 수 없습니다.');
      const { text, pages } = await documentText(buffer, safe);
      const item = { id: randomUUID(), name: safe, size: buffer.length, pages, chars: text.length, text };
      items.set(item.id, item);
      if (items.size > MAX_KEPT) items.delete(items.keys().next().value);
      return publicAttachment(item);
    },
    // Text for one request, cut to a shared budget in the order the user attached them.
    resolve(ids) {
      if (!Array.isArray(ids) || !ids.length) return [];
      if (ids.length > MAX_FILES) throw fail(`한 번에 최대 ${MAX_FILES}개 파일을 첨부하세요.`);
      let budget = MAX_CHARS;
      return [...new Set(ids)].map(id => {
        const item = items.get(id);
        if (!item) throw fail('첨부 파일을 찾을 수 없습니다. 앱을 다시 시작하면 첨부가 사라지므로 파일을 다시 추가하세요.');
        const text = item.text.slice(0, Math.max(0, budget)); budget -= text.length;
        return { name: item.name, pages: item.pages, chars: item.chars, text, truncated: text.length < item.chars };
      });
    },
  };
}
