// Structured output arrives in fragments. Display its summary, never raw JSON.
export function readable(text: string) {
  if (!text.trimStart().startsWith('{')) return text;
  try { return JSON.parse(text).summary || ''; } catch {
    const value = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text)?.[1];
    if (!value) return '';
    try { return JSON.parse(`"${value.replace(/\\(?:u[\da-f]{0,3})?$/i, '')}"`); } catch { return ''; }
  }
}
