// Shared process helpers for agent CLIs: command discovery, JSON-line streaming,
// cancellation and timeouts. Providers only describe arguments and parse events.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export const exec = promisify(execFile);
export const REQUEST_TIMEOUT_MS = 600000;
export const timeoutMessage = `응답 시간이 ${REQUEST_TIMEOUT_MS / 60000}분을 초과했습니다. 범위를 줄여 다시 시도하세요.`;
export const cancelled = () => new Error('요청이 취소되었습니다.');

// Node scripts run with the current runtime. Inside Electron the binary must act as Node.
export const nodeRuntime = () => ({ command: process.execPath, env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} });

async function where(name) {
  try {
    const { stdout } = await exec('where.exe', [name], { windowsHide: true });
    return stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch { return []; }
}

// npm installs `.cmd` shims. Windows refuses to spawn them without a shell, so run the target directly.
async function fromShim(shim) {
  const text = await fs.readFile(shim, 'utf8').catch(() => '');
  const target = /"%dp0%\\([^"]+?\.(?:exe|js|cjs|mjs))"/i.exec(text)?.[1];
  if (!target) return null;
  const file = path.join(path.dirname(shim), target);
  try { await fs.access(file); } catch { return null; }
  if (/\.exe$/i.test(file)) return { command: file, prefix: [], env: {} };
  const node = (await where('node.exe'))[0];
  return node ? { command: node, prefix: [file], env: {} } : { ...nodeRuntime(), prefix: [file] };
}

/**
 * Resolve an executable to { command, prefix, env }. `prefix` precedes provider arguments.
 * Order: explicit env override, native exe on PATH, npm shim, extra candidates, bare name.
 */
export async function resolveCommand(name, { envVar, candidates = async () => [] } = {}) {
  const override = envVar && process.env[envVar];
  if (override) return /\.(c|m)?js$/i.test(override) ? { ...nodeRuntime(), prefix: [override] } : { command: override, prefix: [], env: {} };
  if (process.platform === 'win32') {
    const exe = (await where(`${name}.exe`))[0];
    if (exe) return { command: exe, prefix: [], env: {} };
    for (const shim of await where(`${name}.cmd`)) { const resolved = await fromShim(shim); if (resolved) return resolved; }
    for (const file of await candidates()) { try { await fs.access(file); return { command: file, prefix: [], env: {} }; } catch {} }
  }
  return { command: name, prefix: [], env: {} };
}

export function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); killer.on('error', () => child.kill()); }
  else child.kill('SIGTERM');
}

/**
 * Spawn a CLI that writes one JSON object per stdout line.
 * Resolves { code, stderr } after exit; rejects on spawn error, cancellation or timeout.
 */
export function runJsonLines({ resolved, args, cwd, env = {}, input, signal, timeout = REQUEST_TIMEOUT_MS, onJson, onText = () => {}, onProcess = () => {}, label = '에이전트' }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const child = spawn(resolved.command, [...resolved.prefix, ...args], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...resolved.env, ...env } });
    onProcess(child);
    const decoder = new StringDecoder('utf8');
    let buffer = '', stderr = '', settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      error ? reject(error) : resolve(value);
    };
    const cancel = () => { killTree(child); finish(cancelled()); };
    const timer = setTimeout(() => { killTree(child); finish(new Error(timeoutMessage)); }, timeout);
    signal?.addEventListener('abort', cancel, { once: true });
    const line = text => {
      if (!text.trim()) return;
      let event; try { event = JSON.parse(text); } catch { onText(text); return; }
      try { onJson(event); } catch { /* A malformed event never stops the stream. */ }
    };
    child.on('error', error => finish(new Error(`${label} 실행 실패: ${error.message}`)));
    child.stdout.on('data', chunk => { buffer += decoder.write(chunk); const lines = buffer.split('\n'); buffer = lines.pop() || ''; lines.forEach(line); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
    child.on('close', code => { line(buffer + decoder.end()); finish(null, { code, stderr }); });
  });
}

export async function readAudit(directory) {
  const text = await fs.readFile(path.join(directory, 'source-reads.jsonl'), 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}
