// Inputs that keep typing local (the composer) register a flush here, so shutdown and workspace
// switches can push the latest text into the session before saving it.
const flushers = new Set<() => void>();

export function registerPendingEdit(flush: () => void) { flushers.add(flush); return () => { flushers.delete(flush); }; }
export function flushPendingEdits() { for (const flush of flushers) flush(); }
