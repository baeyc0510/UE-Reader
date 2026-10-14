import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';

hljs.registerLanguage('cpp', cpp);
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Keep multiline comments/raw strings intact, then balance spans for virtual rows.
function highlightLines(text: string) {
  const html = hljs.highlight(text, { language: 'cpp', ignoreIllegals: true }).value;
  const stack: string[] = [];
  return html.split('\n').map(line => {
    const prefix = stack.join('');
    const result = line.split(/(<\/?span\b[^>]*>)/g).map(part => {
      if (part.startsWith('<span')) { stack.push(part); return part; }
      if (part === '</span>') { stack.pop(); return part; }
      // Naming conventions supplement C++ parsing only in unclassified code.
      if (stack.some(tag => /hljs-(comment|string|number|meta)/.test(tag))) return part;
      return part.replace(/\b(?:[A-Z][A-Z0-9_]{2,}|[FAUTEIS][A-Z][A-Za-z0-9_]*|u?int(?:8|16|32|64))\b/g, token => {
        const kind = /^[A-Z][A-Z0-9_]{2,}$/.test(token) ? 'macro' : 'type';
        return `<span class="hljs-${kind}">${token}</span>`;
      });
    }).join('');
    return prefix + result + '</span>'.repeat(stack.length);
  });
}
self.onmessage = ({ data }: MessageEvent<string>) => {
  try { self.postMessage(highlightLines(data)); }
  catch { self.postMessage(data.split('\n').map(escape)); }
};
