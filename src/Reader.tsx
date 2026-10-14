// Screen composition and cross-panel behavior: navigation history, code ↔ explanation scroll link,
// agent requests and job polling. Panels are presentational; see Docs/CODE_INDEX.md.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, PanelLeftOpen, Plus, Search, ShieldCheck, ArrowLeft, ArrowRight, X } from 'lucide-react';
import { api, json, upload } from './api/client';
import { IconButton } from './components/common/IconButton';
import { TopBar } from './components/layout/TopBar';
import { StatusBar } from './components/layout/StatusBar';
import { TabBar } from './components/layout/TabBar';
import { Welcome } from './components/layout/Welcome';
import { BootScreen, IndexBanner } from './components/layout/BootScreen';
import { ExplorerSidebar } from './components/explorer/ExplorerSidebar';
import { SourcePanel } from './components/source/SourcePanel';
import { LinkRail } from './components/source/LinkRail';
import type { CodeHandle, CodeTarget } from './components/source/CodePane';
import type { CodeAction } from './components/source/SourcePanel';
import { ExplanationPanel } from './components/explanation/ExplanationPanel';
import type { NoteContentEdit } from './components/explanation/EditableExplanation';
import { QuestionPanel } from './components/chat/QuestionPanel';
import { WorkspaceModal } from './components/modals/WorkspaceModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { SearchModal, type SearchMode } from './components/modals/SearchModal';
import { SavedNotesModal } from './components/modals/SavedNotesModal';
import { RefineModal, type RefineRequest } from './components/modals/RefineModal';
import { FoldersModal } from './components/modals/FoldersModal';
import { RenameModal, ShutdownModal } from './components/modals/SmallModals';
import { useWorkspaceSession } from './hooks/useWorkspaceSession';
import { useFileIndex } from './hooks/useFileIndex';
import { useUsage } from './hooks/useUsage';
import { useChats } from './hooks/useChats';
import { useCodeIndex } from './hooks/useCodeIndex';
import { applyAppearance, defaultAppearance, fontStack, type Appearance } from './lib/appearance';
import { basename, errorText, stem } from './lib/format';
import { findNoteAtLine, isDetached, teachingOrder } from './lib/notes';
import { parentFolders } from './lib/paths';
import { readingInset } from './lib/scroll';
import { defaultSession, type AgentInfo, type AgentStatus, type Attachment, type Chat, type Context, type Conversation, type ConversationSettings as ConversationOptions, type Job, type Note, type Session, type Source, type SymbolHit, type SymbolQuery, type Workspace } from './types';

const demoFile = 'Source/ReaderDemo/Private/ReadingActor.cpp';
const generalWorkspace: Workspace = { id: 'general', root: '', name: '일반 질문', version: '미확인', demo: false };
function initialSession(saved: Partial<Session> | undefined, w?: Workspace) {
  const next: Session = { ...defaultSession, ...saved };
  if (!saved && !next.tabs.length && w?.demo) { next.tabs = [demoFile]; next.active = demoFile; }
  if (!saved?.expandedFolders) next.expandedFolders = parentFolders(next.active);
  return next;
}
const fallbackAgent = (id: string): AgentInfo => ({ id, label: id === 'codex' ? 'Codex' : id, loginHint: '', supportsUsage: id === 'codex' });

export function Reader({ onStopped }: { onStopped: () => void }) {
  const [appearance, setAppearance] = useState<Appearance>(defaultAppearance);
  useEffect(() => applyAppearance(appearance), [appearance]);
  const [ready, setReady] = useState(false), [workspaces, setWorkspaces] = useState<Workspace[]>([]), [workspaceId, setWorkspaceId] = useState(''), [dataDir, setDataDir] = useState('');
  const { session, setSession, sessionRef, update, settle, saveState, retrySave } = useWorkspaceSession({ ready, workspaceId });
  const workspaceRef = useRef(workspaceId); workspaceRef.current = workspaceId;
  const workspace = workspaces.find(w => w.id === workspaceId);
  const [error, setError] = useState(''), [toast, setToast] = useState('');
  const report = useCallback((e: unknown) => setError(errorText(e)), []);
  const notify = (text: string) => setToast(text);

  // Agents: which CLI answers, its models and login state.
  const [agents, setAgents] = useState<AgentInfo[]>([]), [agentId, setAgentId] = useState('codex'), [models, setModels] = useState<Record<string, string | null>>({});
  const agent = agents.find(a => a.id === agentId) || fallbackAgent(agentId);
  const agentLabel = (id?: string) => (agents.find(a => a.id === (id || 'codex')) || fallbackAgent(id || 'codex')).label;
  const model = models[agentId] ?? null;
  const [status, setStatus] = useState<AgentStatus>({ available: false, authenticated: false, message: '연결 확인 중' });
  const checkStatus = () => { setStatus(s => ({ ...s, message: '연결 확인 중…' })); api<AgentStatus>(`/agents/${agentId}/status`).then(setStatus).catch(report); };
  useEffect(() => { if (ready) checkStatus(); }, [ready, agentId]);
  const { usage, loading: usageLoading, refresh: refreshUsage } = useUsage(ready ? agentId : '');
  const { status: codeIndex, refresh: refreshCodeIndex } = useCodeIndex(workspaceId, ready && !!workspace?.root);
  const [conversationSettings, setConversationSettings] = useState<ConversationOptions>({ retainSession: false, historyCount: 6 });
  // Extended thinking: research agent before each request, review pass for explanations (server setting).
  const [extendedThinking, setExtendedThinking] = useState(false);
  const toggleExtended = async (enabled: boolean) => {
    setExtendedThinking(enabled);
    try { setExtendedThinking((await api<{ extendedThinking: boolean }>('/settings/extended-thinking', json('PUT', { enabled }))).extendedThinking); notify(enabled ? '확장된 사고를 켰습니다. 다음 요청부터 탐색 에이전트가 먼저 조사하고, 해설은 검토 단계를 거칩니다.' : '확장된 사고를 껐습니다.'); }
    catch (e) { setExtendedThinking(!enabled); report(e); }
  };

  const [source, setSource] = useState<Source | null>(null), [notes, setNotes] = useState<Note[]>([]), [fileError, setFileError] = useState(''), [loading, setLoading] = useState(false);
  const { files, info: fileInfo, rebuild, cancel: cancelIndex, reload: reloadFiles } = useFileIndex(workspaceId, report);
  const [fileFilter, setFileFilter] = useState(''), [reveal, setReveal] = useState(0);
  const [focusConversation, setFocusConversation] = useState({ id: '', serial: 0 });
  const [modal, setModal] = useState<'workspace' | 'search' | 'saved' | 'settings' | 'refine' | 'folders' | null>(null), [searchInitial, setSearchInitial] = useState<SymbolQuery & { mode?: SearchMode }>({ term: '' });
  const [rootInput, setRootInput] = useState(''), [relocate, setRelocate] = useState(false), [connecting, setConnecting] = useState(false);
  const [activeNoteId, setActiveNoteId] = useState(''), [visibleLine, setVisibleLine] = useState(1), [find, setFind] = useState(''), [findOpen, setFindOpen] = useState(false);
  const [job, setJob] = useState<Job | null>(null), [outlineOpen, setOutlineOpen] = useState(true);
  const [attachments, setAttachments] = useState<Attachment[]>([]), [attaching, setAttaching] = useState(false);
  const [renaming, setRenaming] = useState<Note | null>(null), [undo, setUndo] = useState<{ message: string; action: () => void } | null>(null), [savedRefresh, setSavedRefresh] = useState(0);
  const [sourceSelection, setSourceSelection] = useState<Context | null>(null), [selectionReveal, setSelectionReveal] = useState(0), [preview, setPreview] = useState<Context | null>(null);
  const [shutdownOpen, setShutdownOpen] = useState(false), [shuttingDown, setShuttingDown] = useState(false), [shutdownError, setShutdownError] = useState('');
  const codeRef = useRef<CodeHandle>(null), notesRef = useRef<HTMLDivElement>(null), splitRef = useRef<HTMLDivElement>(null);
  const pendingNote = useRef<{ id?: string; path: string; start: number } | null>(null), lastTreeFile = useRef({ workspaceId: '', active: '' });
  const lastSide = useRef<'code' | 'notes'>('code'), autoNotesUntil = useRef(0), requestCounter = useRef(0), pendingLine = useRef<number | null>(null);
  const nav = useRef<{ path: string; line?: number; code?: number; notes?: number }[]>([]), navIndex = useRef(-1), [, updateNav] = useState(0);
  const pendingPosition = useRef<{ code: number; notes: number } | null>(null), pendingFlash = useRef(false);
  const closedTabs = useRef<string[]>([]), lastRefine = useRef<RefineRequest>({ paths: [], question: '', allowAdd: false, allowDelete: false });
  const [refineInitial, setRefineInitial] = useState<RefineRequest>(lastRefine.current);

  const { chats, conversations, refreshChats, refreshConversations, rename: renameChat, setDeleted: setChatDeleted } = useChats(workspaceId, ready ? session.activeChatId : undefined, report);
  const activeChatId = session.activeChatId || '';
  const selectedNotes = useMemo(() => teachingOrder(notes.filter(n => n.selected)), [notes]);
  const activeNote = notes.find(n => n.id === activeNoteId);
  const draft = session.questionDraft ?? session.drafts[session.active] ?? '';
  const running = job?.status === 'running';

  // Pick the latest chat when none is chosen; forget a chat that no longer exists.
  useEffect(() => {
    if (!ready || !chats) return;
    const id = session.activeChatId;
    if (id === undefined || (id && id !== job?.chatId && !chats.some(c => c.id === id))) update({ activeChatId: chats[0]?.id ?? '' });
  }, [ready, chats, session.activeChatId]);

  async function shutdownApp() {
    setShuttingDown(true); setShutdownError('');
    try {
      if (running && job) {
        await api(`/jobs/${job.id}/cancel`, json('POST'));
        for (let i = 0; i < 100; i++) {
          const current = await api<Job>(`/jobs/${job.id}`);
          if (current.status !== 'running') break;
          if (i === 99) throw new Error('작업을 취소하고 있습니다. 잠시 후 다시 종료하세요.');
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      if (!await settle()) throw new Error('질문과 화면 상태를 저장하지 못했습니다. 다시 시도하세요.');
      const control = await api('/lifecycle');
      await api('/shutdown', json('POST', { token: control.token }));
      onStopped();
    } catch (e) { setShutdownError(errorText(e)); setShuttingDown(false); setShutdownOpen(true); }
  }
  useEffect(() => window.ueReader?.onCloseRequested(() => {
    if (running || !ready) { setShutdownError(''); setShutdownOpen(true); }
    else void shutdownApp();
  }), [running, ready, session]);

  const [bootStep, setBootStep] = useState(0), [bootError, setBootError] = useState('');
  useEffect(() => {
    api('/health').then(() => { setBootStep(1); return api('/bootstrap'); }).then(data => {
      setAppearance({ ...defaultAppearance, ...data.settings?.appearance });
      setWorkspaces(data.workspaces); setDataDir(data.dataDir);
      setAgents(data.agents || []); setAgentId(data.settings.agent || 'codex'); setModels({ ...data.settings.models, [data.settings.agent || 'codex']: data.settings.model ?? null });
      setConversationSettings({ retainSession: data.settings?.retainSession === true, historyCount: data.settings?.historyCount ?? 6 });
      setExtendedThinking(data.settings?.extendedThinking === true);
      const id = data.activeWorkspace || 'general';
      setWorkspaceId(id);
      const next = initialSession(data.sessions[id], data.workspaces.find((w: Workspace) => w.id === id));
      setSession(next);
      if (next.active) { nav.current = [{ path: next.active }]; navIndex.current = 0; }
      if (data.runningJobs.length) setJob(data.runningJobs[0]);
      setBootStep(2); setReady(true);
    }).catch(e => setBootError(errorText(e)));
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = session.theme; }, [session.theme]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); } }, [toast]);

  const treeFiles = useMemo(() => session.active && !files.includes(session.active) ? [...files, session.active] : files, [files, session.active]);
  useEffect(() => {
    if (!ready) return;
    const previous = lastTreeFile.current; lastTreeFile.current = { workspaceId, active: session.active };
    if (session.active && previous.workspaceId === workspaceId && previous.active !== session.active) update(s => ({ ...s, expandedFolders: [...new Set([...s.expandedFolders, ...parentFolders(s.active)])] }));
  }, [ready, workspaceId, session.active, update]);
  function revealCurrentFile() { setFileFilter(''); update(s => ({ ...s, sidebar: true, expandedFolders: [...new Set([...s.expandedFolders, ...parentFolders(s.active)])] })); setReveal(n => n + 1); }

  // Cross-tab links: an explanation back to its answer, an answer to its explanation.
  async function showQuestion(conversationId: string, chatId?: string) {
    let target = chatId;
    if (!target) { try { target = (await api<Conversation[]>(`/workspaces/${workspaceId}/conversations`)).find(c => c.id === conversationId)?.chatId; } catch { /* Fall back to the current chat. */ } }
    if (target && chats && !chats.some(c => c.id === target)) { notify('원래 질문이 있던 채팅이 삭제되었습니다.'); return; }
    update(s => ({ ...s, rightTab: 'questions', ...(target ? { activeChatId: target } : {}) }));
    setFocusConversation(old => ({ id: conversationId, serial: old.serial + 1 }));
  }
  function showExplanation(file: string, start: number, id?: string) { pendingNote.current = { id, path: file, start }; update({ rightTab: 'notes' }); openFile(file, start); }
  useEffect(() => {
    const pending = pendingNote.current;
    if (!pending || pending.path !== session.active || session.rightTab !== 'notes') return;
    const note = notes.find(n => n.selected && (pending.id ? n.id === pending.id : pending.start >= n.start && pending.start <= n.end));
    if (!note) return;
    pendingNote.current = null;
    requestAnimationFrame(() => requestAnimationFrame(() => jumpNote(note)));
  }, [notes, session.active, session.rightTab]);
  async function openCounterpart() {
    const name = stem(session.active);
    try {
      const data = await api(`/workspaces/${workspaceId}/files?q=${encodeURIComponent(name)}`);
      const matches = data.files.filter((f: string) => f !== session.active && stem(f) === name);
      if (matches.length === 1) openFile(matches[0]);
      else { setSearchInitial({ term: name, mode: 'files' }); setModal('search'); if (!matches.length) notify('같은 이름의 관련 파일을 검색합니다.'); }
    } catch (e) { report(e); }
  }

  const refreshFile = useCallback(async (restore = false) => {
    if (!workspaceId || !session.active) { setSource(null); setNotes([]); return; }
    const ticket = ++requestCounter.current;
    setLoading(true); setFileError('');
    try {
      const data = await api(`/workspaces/${workspaceId}/file?path=${encodeURIComponent(session.active)}`);
      if (ticket !== requestCounter.current) return;
      setSource(data.source); setNotes(data.notes); setFileError(data.error || '');
      if (restore) {
        setActiveNoteId('');
        const position = pendingPosition.current || sessionRef.current.positions[session.active];
        pendingPosition.current = null;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (pendingLine.current !== null) { codeRef.current?.go(pendingLine.current); if (pendingFlash.current) codeRef.current?.flash(pendingLine.current); pendingLine.current = null; }
          else codeRef.current?.restore(position?.code || 0);
          if (notesRef.current) { autoNotesUntil.current = Date.now() + 250; notesRef.current.scrollTop = position?.notes || 0; }
        }));
      }
    } catch (e) { if (ticket === requestCounter.current) { setSource(null); setNotes([]); setFileError((e as Error).message); } }
    finally { if (ticket === requestCounter.current) setLoading(false); }
  }, [workspaceId, session.active]);
  useEffect(() => { setSource(null); setNotes([]); refreshFile(true); return () => { requestCounter.current++; }; }, [refreshFile]);
  useEffect(() => { const check = () => { if (document.visibilityState === 'visible') refreshFile(false); }; document.addEventListener('visibilitychange', check); return () => document.removeEventListener('visibilitychange', check); }, [refreshFile]);

  // Poll the running request; on completion refresh history and open what it produced.
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await api<Job>(`/jobs/${job.id}`); if (cancelled) return;
        setJob(next); if (next.status === 'running') return;
        refreshUsage(true); refreshChats().catch(report); refreshConversations().catch(report);
        if (next.workspaceId === workspaceId && (next.path === session.active || next.paths?.includes(session.active))) refreshFile(false);
        if (next.status !== 'complete') return;
        setSavedRefresh(n => n + 1);
        const generated = next.generatedNotes?.[0], current = sessionRef.current;
        const chatNotes = next.kind === 'question' ? next.generatedNotes?.length || 0 : 0;
        notify(next.kind === 'refine' ? '다듬은 해설을 저장했습니다.' : chatNotes ? `채팅 요청으로 코드 해설 ${chatNotes}개 구간을 생성했습니다.` : '분석 결과가 저장되었습니다.');
        const idle = next.workspaceId === workspaceRef.current && !(current.questionDraft ?? current.drafts[''] ?? '').trim();
        if (next.kind !== 'question' && next.kind !== 'refine' && generated && next.workspaceId === workspaceRef.current && current.rightTab === 'notes' && current.active === (next.requestPath || '')) showExplanation(generated.path, generated.start, generated.id);
        // Explanations requested in chat open at the first one unless the user started another question.
        else if (chatNotes && generated && idle) showExplanation(generated.path, generated.start, generated.id);
        const first = next.kind === 'question' && !chatNotes ? next.suggestedFiles?.[0] : undefined;
        // A fileless question opens the first verified file unless the user moved on (opened a file or started a new question).
        if (first && idle && !next.requestPath && !current.active) openFile(first.path, first.start);
      } catch (e) { if (!cancelled) report(e); }
    };
    const timer = setInterval(poll, 1000); return () => { cancelled = true; clearInterval(timer); };
  }, [job?.id, job?.status, refreshFile, refreshConversations, refreshChats, workspaceId, session.active]);

  // Navigation history (Alt ←/→) remembers both scroll positions per entry. `flash` blinks the target line.
  function openFile(file: string, line?: number, record = true, flash = false) {
    update(s => ({ ...s, expandedFolders: [...new Set([...s.expandedFolders, ...parentFolders(file)])] }));
    if (record && (file !== session.active || line)) {
      if (nav.current[navIndex.current]) Object.assign(nav.current[navIndex.current], { code: codeRef.current?.top() || 0, notes: notesRef.current?.scrollTop || 0 });
      nav.current = nav.current.slice(0, navIndex.current + 1); nav.current.push({ path: file, line }); navIndex.current = nav.current.length - 1; updateNav(n => n + 1);
    }
    if (file === session.active) { if (line) { codeRef.current?.go(line); if (flash) codeRef.current?.flash(line); } }
    else { pendingLine.current = line ?? null; pendingFlash.current = flash; update(s => ({ ...s, active: file, tabs: s.tabs.includes(file) ? s.tabs : [...s.tabs, file] })); }
    setFind(''); setFileFilter('');
  }
  function travel(direction: number) {
    const next = navIndex.current + direction; if (next < 0 || next >= nav.current.length) return;
    if (nav.current[navIndex.current]) Object.assign(nav.current[navIndex.current], { code: codeRef.current?.top() || 0, notes: notesRef.current?.scrollTop || 0 });
    navIndex.current = next; const destination = nav.current[next];
    if (destination.code !== undefined) {
      if (destination.path === session.active) { codeRef.current?.restore(destination.code); if (notesRef.current) { autoNotesUntil.current = Date.now() + 250; notesRef.current.scrollTop = destination.notes || 0; } }
      else pendingPosition.current = { code: destination.code, notes: destination.notes || 0 };
    }
    openFile(destination.path, destination.code === undefined ? destination.line : undefined, false); updateNav(n => n + 1);
  }
  // Closing the active tab activates the nearest remaining tab to its left (else the first). Ctrl+Shift+T reopens.
  function closeTabs(files: string[]) {
    if (!files.length) return;
    closedTabs.current = [...closedTabs.current.filter(f => !files.includes(f)), ...files].slice(-30);
    update(s => {
      const tabs = s.tabs.filter(p => !files.includes(p)), at = s.tabs.indexOf(s.active);
      const active = !files.includes(s.active) ? s.active : s.tabs.slice(0, at).reverse().find(p => tabs.includes(p)) || tabs[0] || '';
      return { ...s, tabs, active };
    });
  }
  function reopenTab() { const file = closedTabs.current.pop(); if (file) openFile(file); }
  async function copyText(text: string, what: string) { try { await navigator.clipboard.writeText(text); notify(`${what}를 복사했습니다.`); } catch (e) { report(e); } }
  function revealFile(file: string) { if (file !== session.active) openFile(file); setFileFilter(''); update(s => ({ ...s, sidebar: true, expandedFolders: [...new Set([...s.expandedFolders, ...parentFolders(file)])] })); setReveal(n => n + 1); }

  // Code selection = explicit question context and a highlight in the explanation.
  function previewSource(range: Context | null, revealIt: boolean) { setSourceSelection(range); setPreview(null); if (revealIt && range) setSelectionReveal(n => n + 1); }
  function selectRange(start: number, end: number, shift: boolean, toggle = false) {
    const current = sessionRef.current;
    const old = current.contexts.find(c => c.path === current.active);
    const clear = toggle && !shift && old && start >= old.start && start <= old.end;
    const range = clear ? null : shift && old ? { path: current.active, start: Math.min(old.start, start), end: Math.max(old.start, end) } : { path: current.active, start, end };
    update(s => ({ ...s, contexts: [...s.contexts.filter(c => c.path !== current.active), ...(range ? [range] : [])] }));
    previewSource(range, true);
  }
  useEffect(() => { setSourceSelection(null); }, [session.active, workspaceId]);
  useEffect(() => {
    if (!selectionReveal || session.rightTab !== 'notes') return;
    const container = notesRef.current, target = container?.querySelector<HTMLElement>('.source-linked-highlight');
    if (container && target) { autoNotesUntil.current = Date.now() + 250; container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top - readingInset(container.clientHeight); }
  }, [selectionReveal, session.rightTab]);

  // Scroll link between code lines and explanation cards.
  function position(side: 'code' | 'notes', top: number) { update(s => ({ ...s, positions: { ...s.positions, [s.active]: { code: s.positions[s.active]?.code || 0, notes: s.positions[s.active]?.notes || 0, [side]: top } } })); }
  function alignNotes(note: Note) {
    if (session.rightTab === 'questions') return;
    const container = notesRef.current, el = container?.querySelector<HTMLElement>(`[data-note="${note.id}"]`);
    if (el && container) { autoNotesUntil.current = Date.now() + 200; container.scrollTop += el.getBoundingClientRect().top - container.getBoundingClientRect().top - readingInset(container.clientHeight); }
  }
  function onCodeScroll(line: number, top: number, user: boolean) {
    setVisibleLine(line); position('code', top);
    if (!user) { if (!activeNoteId) { const note = findNoteAtLine(selectedNotes, line); if (note) setActiveNoteId(note.id); } return; }
    lastSide.current = 'code';
    const note = findNoteAtLine(selectedNotes, line);
    if (session.linked && note && note.id !== activeNoteId) alignNotes(note);
    setActiveNoteId(note?.id || '');
  }
  function onNotesScroll() {
    const container = notesRef.current; if (!container || session.rightTab === 'questions') return;
    position('notes', container.scrollTop);
    if (Date.now() < autoNotesUntil.current) return;
    lastSide.current = 'notes';
    const baseline = container.getBoundingClientRect().top + readingInset(container.clientHeight);
    const el = [...container.querySelectorAll<HTMLElement>('[data-note]')].find(el => { const rect = el.getBoundingClientRect(); return rect.top <= baseline && rect.bottom >= baseline; });
    const note = selectedNotes.find(n => n.id === el?.dataset.note);
    if (!note || isDetached(note)) { setActiveNoteId(''); return; }
    if (note.id !== activeNoteId && session.linked) codeRef.current?.go(note.start);
    setActiveNoteId(note.id);
  }
  function toggleLink() {
    if (!session.linked) {
      if (lastSide.current === 'notes' && activeNote && !isDetached(activeNote)) codeRef.current?.go(activeNote.start);
      else { const note = findNoteAtLine(selectedNotes, visibleLine); if (note) { alignNotes(note); setActiveNoteId(note.id); } }
    }
    update({ linked: !session.linked });
  }
  function jumpNote(note: Note) { setActiveNoteId(note.id); alignNotes(note); if (!isDetached(note)) codeRef.current?.go(note.start); }
  function previewSentence(range: Context | null) { setPreview(range); if (range && range.path === session.active) codeRef.current?.reveal(range.start, range.end); }
  useEffect(() => { setPreview(null); }, [session.active, session.rightTab, notes]);

  async function connect(demo = false) {
    setConnecting(true); setError('');
    try { await settle(); const w = await api<Workspace>('/workspaces', json('POST', { root: rootInput, demo, relocateId: relocate ? workspaceId : undefined })); await activate(w, false); setModal(null); setRootInput(''); }
    catch (e) { report(e); } finally { setConnecting(false); }
  }
  async function activate(w: Workspace, post = true) {
    await settle();
    if (post) await api(`/workspaces/${w.id}/activate`, json('POST'));
    const data = await api('/bootstrap'); setWorkspaces(data.workspaces); setWorkspaceId(w.id);
    const next = initialSession(data.sessions[w.id], w);
    setSession(next); setFileFilter(''); setModal(null); setSource(null); setNotes([]); setFileError('');
    nav.current = next.active ? [{ path: next.active }] : []; navIndex.current = nav.current.length - 1;
  }

  // Agent requests. Questions attach only explicitly selected code.
  function contextsFor(kind: string, note?: Note): Context[] {
    if (kind === 'question') return session.contexts;
    if (!source) return [];
    if (note) return [{ path: source.path, start: note.start, end: note.end }];
    if (kind === 'overview') return [{ path: source.path, start: 1, end: Math.min(source.lines, 1200) }];
    const chosen = [...session.contexts];
    if (!chosen.some(c => c.path === source.path)) chosen.push({ path: source.path, start: Math.max(1, visibleLine - 8), end: Math.min(source.lines, visibleLine + 35) });
    return chosen;
  }
  async function start(body: Record<string, unknown>, tab: Session['rightTab']) {
    setError(''); update({ rightTab: tab });
    try {
      const next = await api<Job>(`/workspaces/${workspaceId}/generate`, json('POST', { detail: session.detail, ...(workspace && session.searchScope?.length ? { searchScope: session.searchScope } : {}), ...body }));
      setJob(next);
      if (next.chatId) { await refreshChats().catch(report); update({ activeChatId: next.chatId }); }
      return next;
    } catch (e) { report(e); return null; }
  }
  // `question` overrides the draft (retry). A sent draft is cleared; a rejected one stays for editing.
  async function generate(kind: string, note?: Note, question?: string) {
    if (!workspaceId || (!source && kind !== 'question') || running) return;
    const text = kind === 'question' ? question ?? draft : '';
    const started = await start({ kind, path: kind === 'question' ? '' : source?.path || '', question: text, contexts: contextsFor(kind, note), noteId: note?.id, chatId: kind === 'question' ? activeChatId || undefined : undefined,
      attachments: kind === 'question' && attachments.length ? attachments.map(a => a.id) : undefined }, kind === 'question' ? 'questions' : 'notes');
    if (started && kind === 'question' && question === undefined) update(s => (s.questionDraft ?? s.drafts[s.active] ?? '') === text ? { ...s, questionDraft: '', drafts: { ...s.drafts, [s.active]: '' } } : s);
  }
  // Files picked from anywhere on disk; the server keeps their text until the app exits. Kept after sending, like selected code.
  async function attachFiles(files: File[]) {
    setAttaching(true);
    try {
      for (const file of files) {
        try { const added = await api<Attachment>('/attachments', upload(file)); setAttachments(list => [...list.filter(a => a.name !== added.name), added]); }
        catch (e) { report(new Error(`${file.name}: ${errorText(e)}`)); }
      }
    } finally { setAttaching(false); }
  }
  function explainAnswer(conversation: Conversation, file: string) {
    if (!workspace || running) return;
    if (file) openFile(file);
    void start({ kind: 'answer-explain', conversationId: conversation.id, path: file }, 'notes');
  }
  function visualizeAnswer(conversation: Conversation) {
    if (!workspaceId || running) return;
    void start({ kind: 'question', referenceConversationId: conversation.id, contexts: [], question: `「${conversation.question.slice(0, 400)}」의 주요 호출 흐름 또는 라이프사이클을 시각화하고 각 단계의 역할과 분기 조건을 설명해 주세요.` }, 'questions');
  }
  function askAboutNote(note: Note) {
    update(s => ({ ...s, rightTab: 'questions', contexts: [...s.contexts.filter(c => c.path !== note.path), { path: note.path, start: note.start, end: note.end }] }));
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[aria-label="코드 질문"]')?.focus());
    notify(`${note.title} 구간을 질문 컨텍스트에 추가했습니다.`);
  }
  function openSearch(initial: SymbolQuery & { mode?: SearchMode } = { term: '' }) { setSearchInitial(initial); setModal('search'); }
  // Context menu on code: navigation through the code index, reference search and questions.
  async function codeAction(action: CodeAction, target: CodeTarget) {
    if (action === 'copy') { try { await navigator.clipboard.writeText(target.selection); notify('선택한 텍스트를 복사했습니다.'); } catch (e) { report(e); } return; }
    if (action === 'references') return openSearch({ term: target.word, mode: 'code' });
    if (action === 'symbols') return openSearch({ term: target.word, mode: 'symbols' });
    if (action === 'ask') {
      update(s => ({ ...s, rightTab: 'questions', questionDraft: `\`${target.word}\`의 역할과 동작 방식을 설명해 주세요.`, drafts: { ...s.drafts, [s.active]: `\`${target.word}\`의 역할과 동작 방식을 설명해 주세요.` } }));
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[aria-label="코드 질문"]')?.focus());
      return;
    }
    const params = new URLSearchParams({ path: session.active, line: String(target.line), word: target.word, scope: target.scope, kind: action, ...(target.member ? { member: '1' } : {}) });
    try {
      const { results, unique, source } = await api<{ results: SymbolHit[]; unique?: boolean; source?: string }>(`/workspaces/${workspaceId}/definition?${params}`);
      const types = results.filter(r => ['class', 'struct', 'union', 'enum', 'alias', 'delegate'].includes(r.kind));
      // A local/parameter, a single hit, the only type, or a hit owned by the surrounding scope opens directly.
      const only = source === 'local' || results.length === 1 || unique ? results[0] : action === 'definition' && types.length === 1 ? types[0] : null;
      if (only) openFile(only.path, only.line, true, true);
      else if (results.length) openSearch({ term: target.word, mode: 'symbols', exact: true, kind: action, scope: target.scope });
      else notify(!codeIndex?.files ? '코드 인덱스를 만드는 중입니다. 지역 변수와 매개변수만 찾을 수 있습니다.' : `${target.word}의 ${action === 'definition' ? '정의' : '선언'}를 인덱스에서 찾지 못했습니다. 모든 참조 검색을 사용해 보세요.`);
    } catch (e) { report(e); }
  }
  // Refining saved explanations of several files with the user's request (see server/analysis/refine.mjs).
  function openRefine(paths: string[]) { setRefineInitial({ ...lastRefine.current, paths }); setModal('refine'); }
  function refineNotes(request: RefineRequest) {
    if (running) return;
    lastRefine.current = request;
    if (!request.paths.includes(session.active)) openFile(request.paths[0]);
    void start({ kind: 'refine', ...request }, 'notes');
  }
  async function restoreNotes(ids: string[]) {
    try { await Promise.all(ids.map(id => api(`/notes/${id}`, json('PATCH', { deleted: false })))); setJob(j => j?.refine ? { ...j, refine: { ...j.refine, removedIds: [] } } : j); await refreshFile(false); setSavedRefresh(n => n + 1); notify('삭제한 해설을 되돌렸습니다.'); }
    catch (e) { report(e); }
  }
  // Extra source folders of the workspace; the server rebuilds the file and code indexes.
  async function changeFolders(request: Promise<Workspace>) { const next = await request; setWorkspaces(list => list.map(w => w.id === next.id ? next : w)); reloadFiles(); }
  async function saveNoteContent(id: string, edit: NoteContentEdit) { await api(`/notes/${id}/content`, json('PATCH', edit)); await refreshFile(false); }
  async function changeNote(id: string, body: unknown) { try { await api(`/notes/${id}`, json('PATCH', body)); await refreshFile(false); setSavedRefresh(n => n + 1); } catch (e) { report(e); } }
  function toggleFavorite(file: string) { update(s => ({ ...s, favorites: s.favorites.includes(file) ? s.favorites.filter(f => f !== file) : [...s.favorites, file] })); }
  async function deleteChat(chat: Chat) {
    try {
      await setChatDeleted(chat.id, true);
      if (activeChatId === chat.id) update({ activeChatId: '' });
      setUndo({ message: `‘${chat.title}’ 채팅을 삭제했습니다.`, action: () => { setChatDeleted(chat.id, false).catch(report); } });
    } catch (e) { report(e); }
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); openSearch(); }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 't' && workspace?.root) { e.preventDefault(); openSearch({ term: '', mode: 'symbols' }); }
      if (e.ctrlKey && e.key.toLowerCase() === 'f' && !modal) { e.preventDefault(); setFindOpen(v => !v); }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); toggleLink(); }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); travel(-1); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); travel(1); }
      if (e.ctrlKey && (['PageUp', 'PageDown'].includes(e.key) || e.key === 'Tab') && session.tabs.length) { e.preventDefault(); const i = session.tabs.indexOf(session.active), back = e.key === 'PageUp' || (e.key === 'Tab' && e.shiftKey); openFile(session.tabs[(i + (back ? -1 : 1) + session.tabs.length) % session.tabs.length]); }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'w' && session.active && !modal) { e.preventDefault(); closeTabs([session.active]); }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't' && workspace?.root) { e.preventDefault(); reopenTab(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });

  const explanationPanel = <ExplanationPanel file={session.active} notes={selectedNotes} allNotes={notes} activeNote={activeNote} linked={session.linked} outlineOpen={outlineOpen} demo={!!workspace?.demo}
    notesRef={notesRef} onToggleOutline={() => setOutlineOpen(v => !v)} onGenerate={kind => generate(kind)} onRefine={() => openRefine(session.active ? [session.active] : [])} onScroll={onNotesScroll} onUserScroll={() => { autoNotesUntil.current = 0; }}
    workspaceId={workspaceId} running={running} hasSource={!!source} selection={sourceSelection} contexts={session.contexts} agentLabel={agentLabel}
    navigate={openFile} preview={previewSentence} save={saveNoteContent} jump={jumpNote} ask={askAboutNote} showQuestion={showQuestion}
    rename={setRenaming} regenerate={note => generate('explain', note)} change={changeNote}/>;

  const questionPanel = <QuestionPanel workspaceId={workspaceId} agent={agent} agentLabel={agentLabel} model={model} onModelSettings={() => setModal('settings')}
    settings={conversationSettings} usage={usage} usageLoading={usageLoading} onRefreshUsage={() => refreshUsage(true)}
    onResetSession={async () => { if (activeChatId) await api(`/chats/${activeChatId}/agent-session/reset`, json('POST')); setJob(null); notify(`다음 질문부터 새 ${agent.label} 세션을 시작합니다. 저장된 답변은 유지됩니다.`); }}
    tab={session.active ? session.rightTab : 'questions'} onTab={rightTab => update({ rightTab })} explanation={explanationPanel}
    height={session.composerHeight} onHeight={composerHeight => update({ composerHeight })}
    hasFile={!!session.active} hasWorkspace={!!workspace} draft={draft} contexts={session.contexts} selected={session.contexts}
    extended={extendedThinking} onExtended={toggleExtended} searchScope={workspace ? session.searchScope || [] : []} onSearchScope={searchScope => update({ searchScope })}
    attachments={attachments} attaching={attaching} onAttach={attachFiles} onRemoveAttachment={id => setAttachments(list => list.filter(a => a.id !== id))}
    chats={chats || []} activeChatId={activeChatId} onSelectChat={id => update({ activeChatId: id })} onNewChat={() => update({ activeChatId: '', rightTab: 'questions' })}
    onRenameChat={renameChat} onDeleteChat={deleteChat}
    conversations={conversations} job={job?.workspaceId === workspaceId ? job : null}
    focusConversation={focusConversation} onShowQuestion={showQuestion} onShowExplanation={showExplanation} onExplainAnswer={explainAnswer} onVisualizeAnswer={visualizeAnswer}
    onDraft={text => update(s => ({ ...s, questionDraft: text, drafts: { ...s.drafts, [s.active]: text } }))} onSend={() => generate('question')}
    onRemove={path => { update({ contexts: session.contexts.filter(c => c.path !== path) }); if (sourceSelection?.path === path) setSourceSelection(null); }} onNavigate={openFile}
    onCancel={() => job && api(`/jobs/${job.id}/cancel`, json('POST')).catch(report)} onDismiss={() => setJob(null)} onRestoreNotes={restoreNotes}
    onRetry={() => { if (!job) return; if (job.kind === 'refine') return refineNotes(lastRefine.current); const origin = conversations.find(c => c.id === job.sourceConversationId); if (origin && job.kind === 'question') visualizeAnswer(origin); else if (origin) explainAnswer(origin, job.requestPath || ''); else void generate(job.kind, undefined, job.kind === 'question' ? job.question : undefined); }}
    onRetrySave={() => job && api<Job>(`/jobs/${job.id}/retry-save`, json('POST')).then(next => { setJob(next); refreshFile(false); refreshChats(); refreshConversations(); }).catch(report)}/>;

  const openWorkspaceModal = () => { setRelocate(false); setModal('workspace'); };
  const openRelocate = () => { if (workspace) { setRootInput(workspace.root); setRelocate(true); setModal('workspace'); } };
  return <div className="app-shell">
    <TopBar workspace={workspace} agent={agent} status={status} ready={ready} onWorkspace={openWorkspaceModal} onSearch={() => { openSearch(); }} onSaved={() => setModal('saved')} onSettings={() => setModal('settings')} onExit={() => { setShutdownError(''); setShutdownOpen(true); }}/>
    {shutdownOpen && <ShutdownModal running={running} busy={shuttingDown} error={shutdownError} close={() => setShutdownOpen(false)} onShutdown={shutdownApp}/>}
    {error && <div role="alert" className="error-banner"><span>{error}</span><button onClick={() => setError('')} aria-label="오류 닫기"><X size={16}/></button></div>}
    {!ready ? <BootScreen step={bootStep} error={bootError}/>
      : !workspace ? <main className="no-workspace-layout"><Welcome connecting={connecting} onOpen={openWorkspaceModal} onDemo={() => connect(true)}/><aside className="discovery-panel">{questionPanel}</aside></main>
        : <main className="workspace-layout">
          {session.sidebar && <ExplorerSidebar workspace={workspace} session={session} files={treeFiles} hasFiles={!!files.length} fileInfo={fileInfo} filter={fileFilter} uiSize={appearance.uiSize} reveal={reveal}
            onFilter={setFileFilter} onWidth={sidebarWidth => update({ sidebarWidth })} onCollapse={() => update({ sidebar: false })} onOpen={file => openFile(file)}
            onToggleFolder={(folder, expanded) => update(s => ({ ...s, expandedFolders: expanded ? [...new Set([...s.expandedFolders, folder])] : s.expandedFolders.filter(f => f !== folder) }))}
            onCollapseAll={() => update({ expandedFolders: [] })} onRevealCurrent={revealCurrentFile} onRebuild={rebuild} onCancelIndex={cancelIndex} onToggleFavorite={toggleFavorite} onFolders={() => setModal('folders')} onSearchScope={searchScope => update({ searchScope })}/>}
          <section className="workbench">
            <TabBar tabs={session.tabs} active={session.active} favorites={session.favorites} onOpen={f => openFile(f)} onClose={closeTabs} onReorder={tabs => update({ tabs })}
              onCopy={copyText} onReveal={revealFile} onToggleFavorite={toggleFavorite}
              leading={!session.sidebar && <IconButton label="탐색기 펼치기" onClick={() => update({ sidebar: true })}><PanelLeftOpen size={17}/></IconButton>}
              trailing={<IconButton label="파일 열기" onClick={() => { openSearch(); }}><Plus size={17}/></IconButton>}/>
            {codeIndex && !codeIndex.files && codeIndex.status !== 'error' && <IndexBanner status={codeIndex}/>}
            <div className="breadcrumb"><div className="navigation"><IconButton label="뒤로 (Alt ←)" onClick={() => travel(-1)} disabled={navIndex.current <= 0}><ArrowLeft size={15}/></IconButton><IconButton label="앞으로 (Alt →)" onClick={() => travel(1)} disabled={navIndex.current >= nav.current.length - 1}><ArrowRight size={15}/></IconButton></div>
              <span className="path" title={session.active}>{session.active ? session.active.split('/').map((part, i, arr) => <span key={i} className={i === arr.length - 1 ? 'current' : ''}>{i > 0 && <ChevronRight size={12}/>} {part}</span>) : '파일을 선택하세요'}</span><span className="read-only"><ShieldCheck size={12}/>읽기 전용</span></div>
            {!session.active ? <div className="discovery-layout"><div className="file-welcome"><Search size={40}/><h2>질문에서 시작해 보세요.</h2><p>에이전트가 필요한 소스 파일을 찾아 읽습니다.<br/>직접 파일을 열어 질문할 수도 있습니다.</p><button className="secondary" onClick={() => { openSearch(); }}><Search size={15}/>직접 파일 찾기 <kbd>Ctrl P</kbd></button></div><div className="discovery-panel">{questionPanel}</div></div>
              : <div className="split-workspace" ref={splitRef} style={{ '--split': `${session.split}%` } as CSSProperties}>
                <SourcePanel codeRef={codeRef} workspaceId={workspaceId} source={source} loading={loading} fileError={fileError} fontFamily={fontStack(appearance.codeFont, true)} fontSize={session.fontSize} wrap={session.wrap}
                  contexts={session.contexts} activeNote={activeNote} preview={preview} visibleLine={visibleLine} findOpen={findOpen} find={find} onFind={setFind} onFindOpen={setFindOpen}
                  onCounterpart={openCounterpart} onReload={refreshFile} onRelocate={openRelocate}
                  onCopy={async () => { const c = session.contexts.find(c => c.path === session.active); if (source && c) try { await navigator.clipboard.writeText(source.text.split('\n').slice(c.start - 1, c.end).join('\n')); notify('선택한 코드를 복사했습니다.'); } catch (e) { report(e); } }}
                  onScroll={onCodeScroll} onSelect={selectRange} onPreviewSelection={previewSource} onCodeAction={codeAction} indexReady={!!codeIndex?.files}/>
                <LinkRail split={session.split} linked={session.linked} containerRef={splitRef} onSplit={split => update({ split })} onToggle={toggleLink}/>
                <section className="analysis-panel">{questionPanel}</section>
              </div>}
          </section>
        </main>}
    <StatusBar workspace={workspace} visibleLine={visibleLine} saveState={saveState} onRetrySave={retrySave} codeIndex={workspace?.root ? codeIndex : null} onRefreshIndex={() => refreshCodeIndex()}/>
    {toast && <div className="toast" role="status"><Check size={15}/>{toast}</div>}
    {undo && <div className="undo-toast">{undo.message}<button onClick={() => { undo.action(); setUndo(null); }}>실행 취소</button><button aria-label="삭제 알림 닫기" onClick={() => setUndo(null)}><X size={14}/></button></div>}

    {modal === 'workspace' && <WorkspaceModal relocate={relocate} rootInput={rootInput} connecting={connecting} error={error} workspaces={workspaces} workspaceId={workspaceId} onRoot={setRootInput} onConnect={connect}
      onActivate={w => activate(w).catch(report)} onGeneral={() => activate(generalWorkspace).catch(report)} close={() => setModal(null)}/>}
    {modal === 'settings' && <SettingsModal session={session} update={update} appearance={appearance} onAppearance={async value => { setAppearance(await api('/settings/appearance', json('PUT', value))); }}
      conversation={conversationSettings} onConversation={async next => { setConversationSettings(await api('/settings/conversation', json('PUT', next))); }}
      agents={agents.length ? agents : [agent]} agent={agent} status={status} onCheckStatus={checkStatus}
      onAgent={async id => { const r = await api('/settings/agent', json('PUT', { agent: id })); setAgentId(id); setModels(m => ({ ...m, [id]: r.model ?? null })); }}
      model={model} onModel={async value => { const r = await api('/settings/model', json('PUT', { agent: agentId, model: value })); setModels(m => ({ ...m, [agentId]: r.model })); }}
      dataDir={dataDir} workspace={workspace} onRelocate={openRelocate} close={() => setModal(null)}/>}
    {modal === 'search' && <SearchModal workspaceId={workspace ? workspaceId : ''} hasWorkspace={!!workspace} initial={searchInitial} near={session.active} report={report} close={() => setModal(null)} onOpen={(path, line) => openFile(path, line, true, !!line)}/>}
    {modal === 'folders' && workspace && <FoldersModal workspace={workspace} close={() => setModal(null)} onRelocate={openRelocate} onAdd={(path, name) => changeFolders(api<Workspace>(`/workspaces/${workspaceId}/folders`, json('POST', { path, name: name || undefined })))} onRemove={name => changeFolders(api<Workspace>(`/workspaces/${workspaceId}/folders/${encodeURIComponent(name)}`, json('DELETE')))}/>}
    {modal === 'refine' && <RefineModal workspaceId={workspaceId} initial={refineInitial} running={running} report={report} close={() => setModal(null)} onStart={refineNotes}/>}
    {modal === 'saved' && <SavedNotesModal workspaceId={workspaceId} activePath={session.active} refresh={savedRefresh} report={report} close={() => setModal(null)} onRename={setRenaming} onRefine={openRefine}
      onDelete={async n => { await changeNote(n.id, { deleted: true }); setUndo({ message: '해설을 삭제했습니다.', action: () => { void changeNote(n.id, { deleted: false }); } }); }}
      onOpen={async n => { if (!n.selected) await changeNote(n.id, { selected: true }); update({ rightTab: 'notes' }); openFile(n.path, !isDetached(n) ? n.start : undefined); setModal(null); setTimeout(() => { setActiveNoteId(n.id); alignNotes(n); }, 200); }}/>}
    {renaming && <RenameModal title="해설 이름 변경" label="해설 이름" initial={renaming.title} close={() => setRenaming(null)} onSave={value => changeNote(renaming.id, { title: value })}/>}
  </div>;
}
