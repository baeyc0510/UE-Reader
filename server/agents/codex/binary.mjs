import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveCommand } from '../process.mjs';

// Codex desktop installs versioned folders under %LOCALAPPDATA%\OpenAI\Codex\bin.
async function desktopCandidates() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  try { return (await fs.readdir(base)).reverse().map(dir => path.join(base, dir, 'codex.exe')); } catch { return []; }
}
export const resolveCodex = () => resolveCommand('codex', { envVar: 'CODEX_BIN', candidates: desktopCandidates });

// Every Codex process: no shell, plugins, hooks or sub-agents. Only the app's read-only MCP tools.
export const disabledCodexFeatures = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'multi_agent', 'browser_use', 'computer_use', 'image_generation', 'view_image', 'skill_search'];
export const disableFlags = () => disabledCodexFeatures.flatMap(feature => ['--disable', feature]);

// JSON string syntax is valid for these TOML string/array/table values. No shell is used.
export function sourceServerConfig(server, { required = false } = {}) {
  const config = [`mcp_servers.ue_reader.command=${JSON.stringify(server.command)}`, `mcp_servers.ue_reader.args=${JSON.stringify(server.args)}`, 'mcp_servers.ue_reader.tool_timeout_sec=90'];
  if (required) config.push('mcp_servers.ue_reader.required=true');
  for (const [key, value] of Object.entries(server.env)) config.push(`mcp_servers.ue_reader.env.${key}=${JSON.stringify(value)}`);
  return config;
}
