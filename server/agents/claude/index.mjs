// Claude Code agent: `claude -p --output-format stream-json --json-schema`.
// Only WebSearch/WebFetch built-ins and the app's read-only source MCP tools are available.
import fs from 'node:fs/promises';
import path from 'node:path';
import { runJsonLines, readAudit, exec, cancelled } from '../process.mjs';
import { writeSourceManifest, sourceServer, sourceToolName, sourceActivity, SOURCE_SERVER_NAME, SOURCE_TOOL_NAMES } from '../source-scope.mjs';
import { parseAgentJson } from '../json-output.mjs';
import { createCliSessions } from '../cli-sessions.mjs';
import { resolveClaude } from './binary.mjs';
import { listClaudeModels } from './models.mjs';

const LABEL = 'Claude Code';
const webTools = ['WebSearch', 'WebFetch'];
const authHint = 'Claude Code 로그인이 필요하거나 만료되었습니다. 터미널에서 claude를 실행해 /login으로 다시 로그인하세요.';
const friendly = text => /401|authenticat|oauth|login/i.test(text) ? authHint : text;

export function claudeArgs({ schema, mcpConfig, instructions, model, session }) {
  const allowed = [...webTools, ...(mcpConfig ? SOURCE_TOOL_NAMES.map(name => `mcp__${SOURCE_SERVER_NAME}__${name}`) : [])];
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--json-schema', JSON.stringify(schema),
    '--tools', webTools.join(','), '--allowedTools', allowed.join(','), '--permission-mode', 'dontAsk',
    '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands'];
  if (mcpConfig) args.push('--mcp-config', mcpConfig);
  if (instructions) args.push('--append-system-prompt', instructions);
  if (model) args.push('--model', model);
  if (session) args.push(...(session.resume ? ['--resume', session.id] : ['--session-id', session.id]));
  else args.push('--no-session-persistence');
  return args;
}

// Translate stream-json events into UE Reader progress. `state` collects the final answer.
export function claudeEventHandler(onEvent, state) {
  const tools = new Map();
  return event => {
    if (event.type === 'system' && event.subtype === 'init') onEvent({ stage: 'Claude Code 세션 시작' });
    if (event.type === 'system' && event.subtype === 'api_retry') onEvent({ stage: '연결 재시도 중' });
    if (event.type === 'stream_event') {
      const e = event.event || {};
      if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use' && e.content_block.name === 'StructuredOutput') { state.streamIndex = e.index; state.streamed = ''; }
      if (e.type === 'content_block_delta' && e.index === state.streamIndex && e.delta?.type === 'input_json_delta') { state.streamed += e.delta.partial_json || ''; onEvent({ partial: state.streamed, stage: '답변 작성 중' }); }
    }
    if (event.type === 'assistant') for (const [i, block] of (event.message?.content || []).entries()) {
      if (block.type === 'text' && block.text?.trim() && !/^\s*(\{|```)/.test(block.text)) onEvent({ activity: { id: `${event.message.id}-${i}`, type: 'message', tool: 'commentary', detail: block.text, status: 'complete' } });
      if (block.type !== 'tool_use') continue;
      if (block.name === 'StructuredOutput') { state.structured = block.input; onEvent({ partial: JSON.stringify(block.input), stage: '답변 정리 중' }); continue; }
      const tool = sourceToolName(block.name);
      const progress = tool ? sourceActivity(block.id, tool, block.input, 'running')
        : webTools.includes(block.name) ? { stage: '웹 자료 확인 중', activity: { id: block.id, type: 'web', tool: 'web_search', detail: block.input?.query || block.input?.url || '', status: 'running' } } : null;
      if (progress) { tools.set(block.id, progress.activity); onEvent(progress); }
    }
    if (event.type === 'user') for (const block of event.message?.content || []) {
      const activity = block.type === 'tool_result' && tools.get(block.tool_use_id);
      if (activity) onEvent({ activity: { ...activity, status: block.is_error ? 'failed' : 'complete' } });
    }
    if (event.type === 'result') {
      state.result = event;
      if (event.usage) onEvent({ tokenUsage: { last: { inputTokens: event.usage.input_tokens, cachedInputTokens: event.usage.cache_read_input_tokens, outputTokens: event.usage.output_tokens } } });
    }
  };
}

export function claudeResult(state) {
  const result = state.result;
  if (!result) return null;
  if (result.is_error) throw new Error(friendly(String(result.result || result.subtype || 'Claude Code 요청 실패')));
  if (result.structured_output && typeof result.structured_output === 'object') return result.structured_output;
  if (state.structured && typeof state.structured === 'object') return state.structured;
  return parseAgentJson(result.result, LABEL);
}

export async function runClaude({ directory, cwd = directory, prompt, instructions, responseSchema, sourceRoot, sourceLimits, searchScope, indexAccess, model, session, signal, onEvent = () => {}, onProcess, onContext = () => {} }) {
  await fs.mkdir(directory, { recursive: true });
  let mcpConfig = null;
  if (sourceRoot) {
    const manifest = await writeSourceManifest(path.join(directory, 'source-scope.json'), { root: sourceRoot, limits: sourceLimits, searchScope, indexAccess });
    mcpConfig = path.join(directory, 'mcp.json');
    await fs.writeFile(mcpConfig, JSON.stringify({ mcpServers: { [SOURCE_SERVER_NAME]: { type: 'stdio', ...sourceServer(manifest) } } }));
  }
  const resolved = await resolveClaude();
  if (signal.aborted) throw cancelled();
  const state = {};
  const { code, stderr } = await runJsonLines({ resolved, args: claudeArgs({ schema: responseSchema, mcpConfig, instructions, model, session }), cwd, input: prompt, signal, onProcess, onJson: claudeEventHandler(onEvent, state), label: LABEL });
  for (const context of await readAudit(directory)) onContext(context);
  const value = claudeResult(state);
  if (value) return value;
  throw new Error(friendly(stderr.trim().slice(-1200)) || `Claude Code가 종료되었습니다 (${code}).`);
}

export async function claudeStatus() {
  try {
    const resolved = await resolveClaude();
    const { stdout } = await exec(resolved.command, [...resolved.prefix, 'auth', 'status'], { windowsHide: true, timeout: 12000, env: { ...process.env, ...resolved.env } });
    const status = JSON.parse(stdout);
    return { available: true, authenticated: status.loggedIn === true, message: status.loggedIn ? `로그인됨 · ${status.authMethod || ''}${status.subscriptionType ? ` · ${status.subscriptionType}` : ''}` : authHint };
  } catch (e) { return { available: e.code !== 'ENOENT', authenticated: false, message: e.code === 'ENOENT' ? 'Claude Code CLI를 찾을 수 없습니다. 설치 후 다시 확인하세요.' : authHint }; }
}

export async function claudeVersion() {
  const resolved = await resolveClaude();
  const { stdout } = await exec(resolved.command, [...resolved.prefix, '--version'], { windowsHide: true, timeout: 10000, env: { ...process.env, ...resolved.env } });
  return stdout.trim();
}

export function createClaudeAgent({ store, overrides = {} }) {
  const run = overrides.runner || runClaude;
  return {
    id: 'claude', label: LABEL, loginHint: 'claude (/login)', supportsUsage: false,
    status: overrides.statusProvider || claudeStatus,
    run,
    sessions: overrides.sessionRunner ? { run: overrides.sessionRunner, forget() {}, close() {} } : createCliSessions({ store, agentId: 'claude', runTurn: run }),
    listModels: overrides.modelProvider || listClaudeModels,
    version: overrides.modelVersionProvider || claudeVersion,
  };
}
