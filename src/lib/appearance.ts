// Global fonts and sizes (PUT /api/settings/appearance), applied as CSS on <html>.
export type Appearance = { uiFont: string; codeFont: string; textSize: number; uiSize: number };
export const defaultAppearance: Appearance = { uiFont: 'Segoe UI', codeFont: 'Consolas', textSize: 13, uiSize: 13 };
export function fontStack(name: string, code = false) {
  const safe = name.replace(/["\\]/g, '').trim();
  return `"${safe}", ${code ? "Consolas, 'Malgun Gothic', monospace" : "'Segoe UI', 'Malgun Gothic', sans-serif"}`;
}
export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  root.style.fontFamily = fontStack(appearance.uiFont);
  root.style.fontSize = `${appearance.uiSize}px`;
  root.style.setProperty('--code-font', fontStack(appearance.codeFont, true));
  root.style.setProperty('--reading-font-size', `${appearance.textSize}px`);
}
