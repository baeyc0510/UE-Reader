// Domain types shared by the client. Server shapes: see Docs/CODE_INDEX.md "데이터 모델".
export type WorkspaceFolder = { name: string; path: string };
export type Workspace = { id: string; root: string; name: string; version: string; demo: boolean; folders?: WorkspaceFolder[] };
export type Context = { path: string; start: number; end: number; text?: string; automatic?: boolean };
export type SuggestedFile = Context & { reason: string };
export type WebSource = { title: string; url: string };
export type AnalysisDiagram = { id: string; title: string; kind: 'call-chain' | 'lifecycle' | 'data-flow'; nodes: { id: string; label: string; explanation: string; references: Context[] }[]; edges: { from: string; to: string; label: string; kind: 'call' | 'transition' | 'data' | 'conditional' }[] };
export type Activity = { id?: string; type: 'source' | 'web' | 'message' | 'status'; tool: string; detail: string; status: string; time?: string };
export type ConversationSettings = { retainSession: boolean; historyCount: number };
export type Usage = { buckets: { id: string; name: string; windows: { key: string; remainingPercent: number; windowDurationMins: number | null; resetsAt: number | null }[] }[]; fetchedAt: string | null; stale: boolean; warning: string; unsupported?: boolean };
export type SourceState = 'same' | 'moved' | 'changed' | 'missing';
export type NoteDetail = { title?: string; text: string; start: number; end: number };
export type Note = Context & { diagrams?: AnalysisDiagram[]; diagramRecordId?: string; overview?: string; details?: NoteDetail[]; sourceConversationId?: string; sourceChatId?: string; generationId?: string; id: string; groupId: string; workspaceId: string; title: string; body: string; summary: string; hash: string; snapshot: string; createdAt: string; sequenceAt?: string; order?: number; revision: number; selected: boolean; origin: string; agent?: string; evidence: Context[]; sourceState: SourceState };
export type Source = { path: string; text: string; hash: string; lines: number };
export type ResearchNotes = { summary: string; findings: { topic: string; detail: string; references: Context[] }[]; openQuestions: string[] };
export type ReviewResult = { summary: string; updated: number; added: number; removed: number };
export type Attachment ={ id: string; name: string; size: number; pages: number; chars: number };
export type AttachedFile = { name: string; pages: number; chars: number; truncated: boolean };
export type Conversation = { extended?: boolean; research?: ResearchNotes | null; review?: ReviewResult | null; diagrams?: AnalysisDiagram[]; attachedContexts?: Context[]; attachedFiles?: AttachedFile[]; promptVersion?: string; kind?: string; chatId?: string; agent?: string; explanations?: { path: string; start: number; id: string }[]; sessionId?: string; retainSession?: boolean; id: string; path: string; question: string; answer: string; sections: Note[]; context: Context[]; status: string; error?: string; createdAt: string; promoted: boolean; suggestedFiles?: SuggestedFile[]; webSources?: WebSource[]; activity?: Activity[]; model?: string | null; requestedModel?: string | null; modelNotice?: string };
export type Job = { extended?: boolean; research?: ResearchNotes | null; review?: ReviewResult; paths?: string[]; refine?: { summary: string; updated: number; added: number; removed: number; removedIds: string[] }; warnings?: string[]; sourceConversationId?: string; generatedNotes?: { id: string; path: string; start: number; title: string }[]; sessionId?: string; retainSession?: boolean; chatId?: string | null; agent?: string; id: string; workspaceId: string; path: string; requestPath?: string; question?: string; kind: string; status: string; stage: string; partial: string; error?: string; context: Context[]; suggestedFiles?: SuggestedFile[]; webSources?: WebSource[]; activity?: Activity[]; model?: string | null; requestedModel?: string | null; modelNotice?: string };
export type Chat = { id: string; title: string; titleSource: 'auto' | 'generated' | 'user'; createdAt: string; updatedAt: string; count: number; lastQuestion: string };
export type AgentInfo = { id: string; label: string; loginHint: string; supportsUsage: boolean };
export type AgentStatus = { available: boolean; authenticated: boolean; message: string };
export type NoteFile = { path: string; count: number; updatedAt: string; titles: string[] };

// Per-workspace UI state persisted through PUT /api/workspaces/:id/session.
export type Session = { sidebarWidth: number; expandedFolders: string[]; questionDraft?: string; activeChatId?: string; rightTab: 'notes' | 'questions'; composerHeight: number; tabs: string[]; active: string; positions: Record<string, { code: number; notes: number }>; drafts: Record<string, string>; contexts: Context[]; favorites: string[]; linked: boolean; theme: 'light' | 'dark'; fontSize: number; wrap: boolean; sidebar: boolean; split: number; detail: 'brief' | 'normal'; searchScope?: string[] };
export const defaultSession: Session = { sidebarWidth: 244, expandedFolders: [], rightTab: 'notes', composerHeight: 220, tabs: [], active: '', positions: {}, drafts: {}, contexts: [], favorites: [], linked: true, theme: 'light', fontSize: 13, wrap: false, sidebar: true, split: 55, detail: 'normal' };
export type CodeIndexStatus = { status: 'loading' | 'building' | 'updating' | 'ready' | 'error'; processed: number; total: number; parsed: number; files: number; symbols: number; tokens: number; builtAt: string | null; error: string };
export type SymbolKind = 'class' | 'struct' | 'union' | 'enum' | 'function' | 'declaration' | 'macro' | 'alias' | 'delegate' | 'variable' | 'enumerator';
export type SymbolHit = { name: string; kind: SymbolKind; line: number; scope: string; path: string; preview: string };
export type SymbolQuery = { term: string; exact?: boolean; kind?: 'definition' | 'declaration' | 'type'; scope?: string };
