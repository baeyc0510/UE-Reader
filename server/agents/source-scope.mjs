// Describes the read-only source MCP server (source-mcp.mjs) to any agent CLI.
// The manifest pins the workspace root; reads are audited into <auditDirectory>/source-reads.jsonl.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { nodeRuntime } from './process.mjs';

export const SOURCE_SERVER_NAME = 'ue_reader';
export const SOURCE_TOOL_NAMES = ['list_folders', 'find_symbol', 'search_files', 'search_code', 'read_file', 'search_documents', 'read_document'];
const script = fileURLToPath(new URL('./source-mcp.mjs', import.meta.url));

// limits: optional { calls, chars } tool budget for this request (see source-tools.mjs DEFAULT_LIMITS).
// searchScope: optional relative paths the search tools cover by default; indexAccess: { url, token } for
// the app's indexes (source/agent-index.mjs). Both are re-read every turn.
export async function writeSourceManifest(manifestPath, { root, auditDirectory, limits, searchScope, indexAccess }) {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify({ root, turnId: randomUUID(), auditDirectory: auditDirectory || path.dirname(manifestPath), ...(limits ? { limits } : {}), ...(searchScope?.length ? { searchScope } : {}), ...(indexAccess ? { indexAccess } : {}) }));
  return manifestPath;
}

// Generic stdio server description: { command, args, env }.
export function sourceServer(manifestPath) {
  const { command, env } = nodeRuntime();
  return { command, args: [script, manifestPath], env };
}

// Agents prefix MCP tool names differently (mcp__ue_reader__read_file, ue_reader__read_file ...).
export function sourceToolName(name = '') {
  const plain = String(name).split(/__|\./).pop();
  return SOURCE_TOOL_NAMES.includes(plain) ? plain : null;
}

export const sourceToolLabels = { list_folders: '폴더 구조 확인', find_symbol: '심볼 찾기', search_files: '작업공간 파일 검색', search_code: '소스 내용 검색', read_file: '선택한 소스 읽기', search_documents: '작업공간 문서 검색', read_document: '문서 읽기' };
// The agent-chosen search scope (within) is shown with the activity.
const activityDetail = (args = {}) => [args.path || args.query || args.name || '', ...(Array.isArray(args.within) && args.within.length ? [`범위 ${args.within.join(', ')}`] : [])].filter(Boolean).join(' · ');
export const sourceActivity = (id, tool, args = {}, status) => ({
  stage: `${sourceToolLabels[tool] || '소스 조사'}${activityDetail(args) ? ` · ${activityDetail(args)}` : ''}`,
  activity: { id, type: 'source', tool, detail: activityDetail(args), status },
});
