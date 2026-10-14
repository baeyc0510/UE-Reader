import type { Note } from '../types';

// A note whose source changed or disappeared keeps its text but loses line synchronization.
export const isDetached = (note: Pick<Note, 'sourceState'>) => note.sourceState === 'changed' || note.sourceState === 'missing';

// Teaching order: generations in creation order, then the agent's section order.
// Legacy notes without `order` fall back to line order inside their generation.
export function teachingOrder(notes: Note[]) {
  return [...notes].sort((a, b) => (a.sequenceAt || a.createdAt).localeCompare(b.sequenceAt || b.createdAt) || (a.order ?? a.start) - (b.order ?? b.start) || a.start - b.start);
}

// The summary of the most recent generation introduces the file.
export const latestSummary = (notes: Note[]) => [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.summary;

export const findNoteAtLine = (notes: Note[], line: number) => [...notes].sort((a, b) => a.start - b.start).find(n => !isDetached(n) && line >= n.start && line <= n.end);
