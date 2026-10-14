import { resolveCommand } from '../process.mjs';

// npm installs a .cmd shim that points at a native claude.exe; process.mjs runs the target directly.
export const resolveClaude = () => resolveCommand('claude', { envVar: 'CLAUDE_BIN' });
