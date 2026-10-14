// Reference documents (PDF, Markdown, text, config) as plain text lines. Used by the agents'
// read_document tool (documents inside the workspace) and by chat attachments (files the user picked).
// Documents are reference material only: they never become code evidence, notes or explorer entries.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolveSource, locateInScope, decodeSource, documentExtensions, hash, fail } from './source.mjs';

export const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const pageMark = page => `[페이지 ${page}]`;
let pdfjs;

async function pdfText(buffer) {
  pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Predefined CMaps are needed for CJK PDFs whose fonts carry no ToUnicode table.
  const dir = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')).replaceAll('\\', '/');
  // verbosity 0: pdf.js prints warnings with console.log, which is the MCP process's protocol channel.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, cMapUrl: `${dir}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${dir}/standard_fonts/` }).promise;
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i), content = await page.getTextContent();
      pages.push(`${pageMark(i)}\n${content.items.map(item => (item.str ?? '') + (item.hasEOL ? '\n' : '')).join('').replace(/\n{3,}/g, '\n\n').trim()}`);
      page.cleanup();
    }
    return { text: pages.join('\n\n'), pages: doc.numPages };
  } finally { await doc.destroy(); }
}

/** Text of a PDF or text file: { text, pages } (pages is 0 for text files). */
export async function documentText(buffer, name = '') {
  if (path.extname(name).toLowerCase() === '.pdf' || buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    let result;
    try { result = await pdfText(buffer); }
    catch (e) { throw fail(e?.name === 'PasswordException' ? '암호가 걸린 PDF는 읽을 수 없습니다.' : `PDF에서 텍스트를 추출하지 못했습니다. (${e?.message || e})`); }
    if (!result.text.replace(/\[페이지 \d+\]/g, '').trim()) throw fail('PDF에 읽을 수 있는 텍스트가 없습니다. 스캔한 이미지 PDF일 수 있습니다.');
    return result;
  }
  const text = decodeSource(buffer);
  if (text === null) throw fail('텍스트 또는 PDF 파일만 읽을 수 있습니다.');
  return { text, pages: 0 };
}

// PDFs are slow to parse and are read in several line ranges, so keep the last few by size + mtime.
const cache = new Map();
export async function readDocument(scope, relative) {
  const file = await resolveSource(scope, relative, documentExtensions), { rest, prefix } = locateInScope(scope, relative);
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) throw fail('40MB 이하의 문서만 읽을 수 있습니다.');
  const key = `${stat.size}:${stat.mtimeMs}`, cached = cache.get(file);
  if (cached?.key === key) return cached.doc;
  const { text, pages } = await documentText(await fs.readFile(file), file);
  const doc = { path: (prefix + rest).replaceAll('\\', '/'), text, pages, hash: hash(text), lines: text.split('\n').length };
  cache.delete(file); cache.set(file, { key, doc });
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return doc;
}
