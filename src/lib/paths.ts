// Ancestor folders of a workspace-relative path: 'A/B/c.cpp' → ['A', 'A/B'].
export function parentFolders(file: string) { const parts = file.split('/'); return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/')); }
