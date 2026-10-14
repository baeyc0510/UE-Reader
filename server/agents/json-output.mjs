// Agents without native schema enforcement may wrap JSON in prose or Markdown fences.
// Extract the outermost JSON object; return null when none parses.
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* Try fenced or embedded JSON next. */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1];
  if (fenced) { try { return JSON.parse(fenced.trim()); } catch {} }
  const start = trimmed.indexOf('{'), end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(trimmed.slice(start, end + 1)); } catch {} }
  return null;
}

export function parseAgentJson(text, label) {
  const value = extractJson(text);
  if (!value || typeof value !== 'object') throw new Error(`${label} 응답 형식을 읽지 못했습니다. 다시 시도하세요.`);
  return value;
}
