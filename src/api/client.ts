// Thin fetch wrapper for the local backend (/api). Errors carry the server's Korean message.
export async function api<T = any>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '요청을 완료하지 못했습니다.');
  return data;
}
export const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
/** Raw file upload; the name travels in a header because the body is the file itself. */
export const upload = (file: File): RequestInit => ({ method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } });
