// Codex agent: stateless `codex exec`, retained App Server threads, dynamic model list and rate limits.
import { exec } from '../process.mjs';
import { resolveCodex } from './binary.mjs';
import { runCodex } from './exec.mjs';
import { createCodexSessions } from './sessions.mjs';
import { listCodexModels, codexVersion } from './models.mjs';
import { readCodexLimits, createUsageReader } from './rpc.mjs';

export async function codexStatus() {
  try {
    const resolved = await resolveCodex();
    const { stdout, stderr } = await exec(resolved.command, [...resolved.prefix, 'login', 'status'], { windowsHide: true, timeout: 12000, env: { ...process.env, ...resolved.env } });
    return { available: true, authenticated: /logged in/i.test(stdout + stderr), message: (stdout + stderr).trim() };
  } catch (e) { return { available: e.code !== 'ENOENT', authenticated: false, message: e.code === 'ENOENT' ? 'Codex CLI를 찾을 수 없습니다. 설치 후 다시 확인하세요.' : 'Codex 로그인이 필요합니다. 터미널에서 codex login을 실행하세요.' }; }
}

/** Overrides keep tests deterministic: runner, sessionRunner, sessionConnect, statusProvider, modelProvider, modelVersionProvider, usageProvider. */
export function createCodexAgent({ store, dataDir, overrides = {} }) {
  const sessions = createCodexSessions({ store, connect: overrides.sessionConnect });
  return {
    id: 'codex', label: 'Codex', loginHint: 'codex login', supportsUsage: true,
    status: overrides.statusProvider || codexStatus,
    run: overrides.runner || runCodex,
    sessions: { run: overrides.sessionRunner || sessions.run, forget: sessions.forget, close: sessions.close },
    listModels: overrides.modelProvider || listCodexModels,
    version: overrides.modelVersionProvider || codexVersion,
    usage: createUsageReader({ directory: dataDir, provider: overrides.usageProvider || readCodexLimits }),
  };
}
