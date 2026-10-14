// Stateless Codex request: `codex exec --json --output-schema` in an isolated request folder.
import fs from 'node:fs/promises';
import path from 'node:path';
import { runJsonLines, readAudit, cancelled } from '../process.mjs';
import { writeSourceManifest, sourceServer, sourceActivity } from '../source-scope.mjs';
import { resolveCodex, disableFlags, sourceServerConfig } from './binary.mjs';

export function codexEventHandler(onEvent, state) {
  return event => {
    if (event.type === 'error' || event.type === 'turn.failed') state.error = event.message || event.error?.message || 'Codex 요청 실패';
    const item = event.item;
    if (item?.type === 'agent_message' && item.text) {
      if (item.phase === 'commentary' || !item.text.trimStart().startsWith('{')) onEvent({ activity: { id: item.id, type: 'message', tool: 'commentary', detail: item.text, status: 'complete' } });
      else { state.last = item.text; onEvent({ stage: '응답 정리 중', partial: state.last }); }
    } else if (item?.type === 'mcp_tool_call') onEvent(sourceActivity(item.id, item.tool || '', item.arguments, event.type === 'item.completed' ? 'complete' : 'running'));
    else if (item?.type === 'web_search') onEvent({ stage: '웹 자료 검색 중', activity: { id: item.id, type: 'web', tool: 'web_search', detail: item.query || item.action?.query || item.action?.url || '', status: event.type === 'item.completed' ? 'complete' : 'running' } });
    else if (event.type === 'turn.completed' && event.usage) onEvent({ tokenUsage: { last: { inputTokens: event.usage.input_tokens, cachedInputTokens: event.usage.cached_input_tokens, outputTokens: event.usage.output_tokens } } });
    else if (event.type === 'thread.started') onEvent({ stage: '필요한 자료 조사 중' });
  };
}

export async function runCodex({ directory, prompt, instructions = '', responseSchema, sourceRoot = null, sourceLimits, searchScope, indexAccess, model = null, signal, onEvent = () => {}, onProcess = () => {}, onContext = () => {} }) {
  await fs.mkdir(directory, { recursive: true });
  const schemaPath = path.join(directory, 'response-schema.json'), outputPath = path.join(directory, 'response.json');
  await fs.writeFile(schemaPath, JSON.stringify(responseSchema));
  const resolved = await resolveCodex();
  if (signal.aborted) throw cancelled();
  const args = ['--no-daemon', 'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '-c', 'web_search="live"', '-c', 'project_doc_max_bytes=0', '--json', '--color', 'never', '--output-schema', schemaPath, '-o', outputPath, '-C', directory];
  if (sourceRoot) {
    const manifest = await writeSourceManifest(path.join(directory, 'source-scope.json'), { root: sourceRoot, limits: sourceLimits, searchScope, indexAccess });
    for (const value of sourceServerConfig(sourceServer(manifest))) args.push('-c', value);
  }
  args.push(...disableFlags());
  if (model) args.push('-m', model);
  args.push('-');
  const state = { error: '', last: '' };
  const { code, stderr } = await runJsonLines({ resolved, args, input: `${instructions}\n${prompt}`, signal, onProcess, onJson: codexEventHandler(onEvent, state), label: 'Codex' });
  for (const context of await readAudit(directory)) onContext(context);
  if (code !== 0) throw new Error((state.error || stderr).trim().slice(-1200) || `Codex가 종료되었습니다 (${code}).`);
  try { return JSON.parse(await fs.readFile(outputPath, 'utf8').catch(() => state.last)); }
  catch { throw new Error('Codex 응답 형식을 읽지 못했습니다. 다시 시도하세요.'); }
}
