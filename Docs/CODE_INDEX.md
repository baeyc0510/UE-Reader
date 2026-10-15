# 코드 인덱스

기능을 바꾸거나 확장할 때 **이 문서에서 관련 파일만 찾아 읽기 위한 지도**입니다. 파일을 추가·이동·삭제하거나 책임이 바뀌면 이 문서를 함께 갱신하세요.

## 한눈에 보기

```
desktop/main.mjs ── Electron 창 + 내장 백엔드 (server/app.mjs 재사용)
server/  Express API (127.0.0.1 전용)
  app.mjs ─ 조립: Store · agents · 라우트 마운트
  routes/*        HTTP 엔드포인트 (얇게 유지)
  analysis/*      요청 → 에이전트 → 검증 → 저장 파이프라인, 프롬프트, 응답 스키마
  agents/*        에이전트 CLI 어댑터 (codex / claude) + 공통 프로세스·MCP
  domain/*        채팅·대화·설정·예제 같은 순수 규칙
  source/*        읽기 전용 소스 접근, 파일 인덱스, 코드 위치 검증, code-index/(심볼·검색 인덱스 워커), code-search.mjs
  store/*         reader.json 저장소와 마이그레이션
src/     React UI (Vite)
  Reader.tsx ─ 화면 조립과 패널 간 동작(탐색 기록, 스크롤 연결, 요청·폴링)
  components/<영역>/*  표현 컴포넌트   hooks/*  상태 훅   lib/*  순수 유틸
```

## 기능별 진입점

| 바꾸려는 것 | 먼저 읽을 파일 | 함께 볼 파일 |
| --- | --- | --- |
| 답변·해설의 말투, 깊이, 용어, 해설 순서 | `server/analysis/prompts.mjs` | `tests/chats-agents.test.mjs` (프롬프트 검사) |
| 에이전트 역할(`DEFAULT_ROLE`·`DEFAULT_RESEARCH_ROLE`, 설정에서 변경) | `server/analysis/prompts.mjs`, `server/routes/settings.mjs`(`/settings/roles`) | `domain/settings.mjs#rolePrompts`, `src/components/settings/RoleSettings.tsx` |
| 에이전트 검색 범위(폴더·파일, `Session.searchScope`) | `server/source/source.mjs`(`searchScopePaths`, `inSearchScope`), `server/agents/source-tools.mjs`(`wholeWorkspace`) | `generation.mjs#parseRequest`, `source-scope.mjs`(매니페스트), `prompts.mjs#searchScopeText`, `src/lib/search-scope.ts`, `ExplorerSidebar.tsx`(우클릭 메뉴), `Composer.tsx` |
| 응답 JSON 형식(필드 추가 등) | `server/analysis/schemas.mjs` | `analysis/results.mjs`, `src/types.ts` |
| 요청 처리 흐름(컨텍스트, 이력, 세션, 저장) | `server/analysis/generation.mjs` | `analysis/results.mjs`, `domain/conversations.mjs` |
| 응답 검증·해설 저장 규칙(라인 검증, 버전, 순서) | `server/analysis/results.mjs` | `source/inspected-ranges.mjs`, `lib/notes.ts` |
| 흐름 시각화 | `server/analysis/diagrams.mjs`, `src/components/explanation/AnalysisDiagrams.tsx` | `routes/workspaces.mjs` (`diagram-reference`) |
| 에이전트 CLI 추가·수정 | `server/agents/registry.mjs` | 아래 “에이전트 추가”, 해당 `agents/<id>/index.mjs` |
| Codex 세부(exec, app-server 세션, 모델 목록, 사용량) | `server/agents/codex/*` | `binary.mjs`(실행 파일·비활성 기능) |
| Claude Code 연동 | `server/agents/claude/index.mjs` | `claude/models.mjs`(모델 목록: `initialize` 제어 요청), `claude/binary.mjs`, `agents/cli-sessions.mjs`, `agents/json-output.mjs` |
| 에이전트가 쓰는 소스 도구(`list_folders`·`find_symbol`·search·read, 에이전트가 고르는 범위 `within`) | `server/agents/source-tools.mjs` | `source-mcp.mjs`(MCP 프로세스), `source-scope.mjs`(매니페스트·이름·활동 표시), `prompts.mjs#searchStrategy`(범위를 정한 뒤 검색하는 지침) |
| 에이전트 도구 ↔ 앱 인덱스 연결(요청별 토큰) | `server/source/agent-index.mjs`(서버: `grant`·`revoke`·`query`·`local`) | `agents/index-client.mjs`(MCP 쪽 클라이언트), `routes/code-index.mjs`(`POST /api/agent-index`), `generation.mjs`(`indexAccess` 발급·회수) |
| 작업공간 문서 읽기(PDF·Markdown·텍스트, `search_documents`·`read_document`) | `server/source/documents.mjs`(pdf.js 텍스트 추출·캐시) | `source.mjs`(`documentExtensions`, `toScopePath`, `makeIndex().documents`), `source-tools.mjs`, `prompts.mjs#research` |
| 채팅으로 코드 해설 요청(에이전트가 파일 선택) | `server/analysis/prompts.mjs#questionTask`(조건부 `sections`, `sectionRules` 공유), `schemas.mjs#questionSchema` | `generation.mjs`(질문의 `sections` → 해설 저장, `sourceConversationId` = 답변), `results.mjs#normalizeSections`, `Reader.tsx`(완료 시 첫 해설 열기) |
| 확장된 사고(탐색 에이전트 → 본 요청 → 해설 검토) | `server/analysis/extended.mjs`(조사 결과 검증, 발췌, 검토 병합), `generation.mjs#execute`(`extraPass`, 단계 표시) | `prompts.mjs`(`researchInstructions`, `reviewInstructions`, `buildReviewPrompt`, `researchNotes`), `schemas.mjs#researchSchema`, `domain/settings.mjs#extendedThinking`, `routes/settings.mjs`, `Composer.tsx`(토글), `chat/ResearchNotes.tsx` |
| 질문에 외부 파일 첨부(업로드 → 텍스트 → 프롬프트) | `server/analysis/attachments.mjs`, `server/routes/attachments.mjs` | `generation.mjs#parseRequest`, `prompts.mjs#attachedFiles`, `src/components/chat/Composer.tsx`, `Reader.tsx#attachFiles`, `api/client.ts#upload` |
| 모델 목록·선택 | `server/agents/model-catalog.mjs`(캐시·무효화·기본값 대체), 각 에이전트의 `models.mjs`, `routes/settings.mjs` | `src/components/settings/ModelSettings.tsx` |
| 채팅(생성, 제목, 이름 변경, 삭제) | `server/domain/chats.mjs`, `server/routes/chats.mjs` | `src/hooks/useChats.ts`, `src/components/chat/ChatBar.tsx`, `ChatList.tsx` |
| 채팅 목록 우클릭 메뉴 | `src/components/chat/ChatList.tsx` | `src/components/common/ContextMenu.tsx` |
| 질문 화면(답변 표시, 진행 상황, 입력창) | `src/components/chat/QuestionPanel.tsx` | `ConversationItem.tsx`, `Composer.tsx`, `ActivityFeed.tsx`(해설 작업은 `RecentActivity`: 최근 3단계), `readable.ts` |
| 코드 해설 화면(카드, 목차, 편집) | `src/components/explanation/ExplanationPanel.tsx` | `NoteCard.tsx`, `NoteBody.tsx`, `EditableExplanation.tsx`, `routes/notes.mjs` |
| 저장한 해설(파일 → 해설) | `src/components/modals/SavedNotesModal.tsx` | `routes/notes.mjs` (`/notes/files`, `/notes?path=`) |
| 해설 다듬기(여러 파일, 요청 문구, 추가·삭제 허용) | `server/analysis/refine.mjs`(요청 구성·검증·적용) | `prompts.mjs#refineTask`, `schemas.mjs#refineSchema`, `generation.mjs`(kind `refine`), `src/components/modals/RefineModal.tsx`, `Reader.tsx#refineNotes` |
| 탭(휠 클릭 닫기, 탭 메뉴, 드래그 정렬, Ctrl W · Ctrl Shift T) | `src/components/layout/TabBar.tsx` | `Reader.tsx#closeTabs`, 키보드 처리 `useEffect` |
| 코드 보기(가상 렌더링, 선택, 하이라이트, 이동 대상 깜빡임 `flash`) | `src/components/source/CodePane.tsx` | `SourcePanel.tsx`, `syntax.worker.ts`, `styles/syntax.css` |
| 코드 ↔ 해설 스크롤 연결, 탐색 기록 | `src/Reader.tsx` (Scroll link / Navigation 절) | `lib/notes.ts`, `lib/scroll.ts`, `source/LinkRail.tsx` |
| 탐색기 트리 | `src/components/explorer/FileTree.tsx` | `file-tree.worker.ts`, `ExplorerSidebar.tsx`, `hooks/useFileIndex.ts` |
| 설정 창 항목 | `src/components/modals/SettingsModal.tsx` | `components/settings/*`, `routes/settings.mjs`, `domain/settings.mjs` |
| 코드 인덱스(심볼 추출, 저장·재사용, 검색 후보) | `server/source/code-index/service.mjs` | `worker.mjs`(빌드·증분 갱신), `cpp-symbols.mjs`(C++ 심볼·토큰 추출), `query.mjs`(심볼 검색·후보 파일), `store.mjs`(디스크 형식), `routes/code-index.mjs` |
| 소스 우클릭 메뉴(정의·선언 이동, 참조 검색, 질문) | `src/components/source/SourcePanel.tsx`(메뉴), `CodePane.tsx`(`targetAt`: 포인터 아래 식별자) | `Reader.tsx#codeAction`, `SearchModal.tsx`(심볼 모드), `hooks/useCodeIndex.ts`, `layout/StatusBar.tsx` |
| Markdown 렌더링(표 등 GFM) | `src/components/common/Markdown.tsx` | `styles/markdown.css` |
| 작업공간 열기·이동·검색 | `server/routes/workspaces.mjs` | `source/source.mjs`, `WorkspaceModal.tsx`, `SearchModal.tsx` |
| 작업공간 폴더 여러 개(엔진 + 프로젝트) | `server/source/source.mjs`(`sourceScope`, `locateInScope`, `walkScope`) | `routes/workspaces.mjs`(`/folders`), `prompts.mjs#folderLayout`, `code-index/worker.mjs`, `src/components/modals/FoldersModal.tsx`, `ExplorerSidebar.tsx` |
| 화면 상태 저장(탭, 초안, 활성 채팅 등) | `src/hooks/useWorkspaceSession.ts` | `src/types.ts` (`Session`) |
| 앱 종료·수명 주기 | `server/http/lifecycle.mjs`, `desktop/main.mjs` | `components/modals/SmallModals.tsx` (`ShutdownModal`) |
| 보안(로컬 전용, Origin 검사) | `server/http/security.mjs` | `source/source.mjs` (`resolveSource`) |
| 저장 데이터 형식 변경 | `server/store/migrations.mjs` | `store/store.mjs`, 아래 “데이터 모델” |
| 스타일 | `src/styles/index.css` (가져오기 순서) | 아래 “스타일” |

## 서버

### 조립과 공유 컨텍스트
`server/app.mjs`의 `createApp()`이 `ctx = { store, agents, jobs, indexes, dataDir, projectRoot, workspace(id), getIndex(w), fileNotes(w, path), runningJobs() }`를 만들고 각 `routes/*.mjs`의 `xxxRoutes(app, ctx)`에 전달합니다. 라우트 모듈은 검증과 응답만 하고, 규칙은 `domain/`·`analysis/`·`source/`에 둡니다.

테스트 주입: Codex는 `runner, sessionRunner, sessionConnect, statusProvider, modelProvider, modelVersionProvider, usageProvider`, 다른 에이전트는 `agentOverrides: { claude: {...} }`.

### API

| 메서드·경로 | 파일 | 설명 |
| --- | --- | --- |
| `GET /api/health`, `GET /api/bootstrap` | `app.mjs` | 상태, 초기 데이터(작업공간·화면 상태·설정·에이전트 목록·실행 중 작업) |
| `GET/POST /api/lifecycle`, `/api/shutdown` | `http/lifecycle.mjs` | 종료 토큰, 저장 후 종료 |
| `PUT /api/settings/{appearance,instructions,conversation,agent,model,extended-thinking}` | `routes/settings.mjs` | 전역 설정. `model`은 `{ agent?, model }`, `extended-thinking`은 `{ enabled }` |
| `GET/PUT /api/settings/roles` `{ role, researchRole }` | `routes/settings.mjs` | 에이전트 역할. 빈 값·기본값과 같은 값은 `''`로 저장(기본값 사용), 응답에 `defaults` 포함 |
| `GET /api/agents`, `/api/agents/:agent/{status,models,usage}` | `routes/agents.mjs` | 에이전트 목록·로그인·모델 카탈로그·남은 사용량 |
| `POST /api/workspaces`, `/:id/activate`, `PUT /:id/session` | `routes/workspaces.mjs` | 열기·재연결, 활성화, 화면 상태 |
| `GET /api/workspaces/:id/{files,file,search}`, `POST /:id/index` | `routes/workspaces.mjs` | 파일 인덱스, 파일+해설, 코드 검색(코드 인덱스 준비 시 후보 파일만 읽음) |
| `GET/POST /api/workspaces/:id/code-index`, `GET /:id/symbols?q=&exact=1&kind=&scope=&near=`, `GET /:id/definition?path=&line=&word=&scope=&member=1&kind=` | `routes/code-index.mjs` | 인덱스 상태·갱신(`full`), 심볼 검색, 정의/선언 이동(지역 변수 → 현재 범위 멤버 → 가까운 네임스페이스) |
| `POST /api/agent-index` (헤더 `X-UE-Reader-Agent-Token`) `{ op: files \| candidates \| symbols, args }` | `routes/code-index.mjs` → `source/agent-index.mjs` | 에이전트 소스 도구(MCP 프로세스) 전용. 요청 중에만 유효한 토큰 |
| `POST /api/workspaces/:id/folders` `{ path, name? }`, `DELETE /:id/folders/:name` | `routes/workspaces.mjs` | 추가 소스 폴더(이름 아래에 마운트). 겹치는 폴더·중복 이름·기본 폴더 최상위 항목과 같은 이름은 거부 |
| `POST /api/workspaces/:id/diagram-reference` | `routes/workspaces.mjs` | 시각화 코드 링크 재검증 |
| `GET /api/workspaces/:id/notes[?path=&q=]`, `/notes/files[?q=]` | `routes/notes.mjs` | 저장한 해설(파일 목록 / 파일별) |
| `PATCH /api/notes/:id`, `/api/notes/:id/content` | `routes/notes.mjs` | 이름·삭제·버전·재연결, 블록 편집 |
| `GET /api/workspaces/:id/chats`, `PATCH /api/chats/:id` | `routes/chats.mjs` | 채팅 목록, 이름 변경(`title`)·삭제/복원(`deleted`) |
| `GET /api/workspaces/:id/conversations[?chatId=]` | `routes/chats.mjs` | 채팅의 질문·답변 |
| `POST /api/chats/:id/agent-session/reset` | `routes/chats.mjs` | 채팅의 유지 세션 초기화 |
| `POST /api/attachments` (본문 = 파일, `X-File-Name`) | `routes/attachments.mjs` | 질문 첨부 파일 텍스트 추출(메모리 보관), `{ id, name, size, pages, chars }` |
| `POST /api/workspaces/:id/generate` | `routes/jobs.mjs` → `analysis/generation.mjs` | 질문·해설·해설 다듬기(`kind: 'refine'`) 요청 시작(202 + job). 질문은 `attachments: [id]` 가능 |
| `GET /api/jobs/:id`, `POST /:id/cancel`, `/:id/retry-save` | `routes/jobs.mjs` | 폴링, 취소, 저장 재시도 |

### 요청 파이프라인 (`analysis/generation.mjs`)
1. `parseRequest` — 종류(`question | overview | explain | answer-explain | refine`), 참조 답변, 대상 파일, 첨부 범위, `chatId`, 검색 범위(`searchScope`: 존재하는 작업공간 폴더·파일만, 최대 20개).
2. `collectContexts` — 첨부 범위를 현재 소스에서 읽어 해시와 함께 고정.
3. 설정 캡처 — 에이전트·모델·세션 유지 여부. 질문이면 채팅을 만들거나(첫 질문) 이어감. 이력은 **같은 채팅**의 완료된 질문만(`domain/conversations.mjs#chatHistory`).
4. `prompts.analysisInstructions`(지시문) + `prompts.buildRequestPrompt`(요청) → `agent.run` 또는 `agent.sessions.run`.
5. `results.mjs` — 확인한 소스 범위로 해설·근거·추천 파일 검증, `order`(해설 순서) 부여, 버전 연결(`attachRevisions`).
6. 저장 — 해설은 `notes`, 질문은 `conversations`. 첫 답변의 `title`로 채팅 제목 자동 설정(`domain/chats.mjs#applyAnswerTitle`).

**채팅으로 해설 요청**: 질문 응답 스키마에도 `sections`가 있습니다. 일반 질문은 `[]`이고, 사용자가 채팅에서 해설 작성을 요청하면 에이전트가 대상 파일(보통 1–5개)을 골라 읽고 해설 규칙대로 `sections`를 채웁니다(`summary`는 고른 파일과 읽는 순서를 알리는 짧은 답). 서버는 대상 파일 제한 없이 확인한 범위로 검증해 해설로 저장하고, 해설의 `sourceConversationId/sourceChatId`를 그 답변으로 연결합니다(답변 아래 “생성한 코드 해설” 링크, 해설 카드의 “원래 질문·답변”). 확장된 사고가 켜져 있으면 이 해설도 검토 단계를 거칩니다. 의도 판단은 에이전트가 하며 서버에는 키워드 규칙이 없습니다.

**확장된 사고(`settings.extendedThinking`, refine 제외)**: 요청 시작 시 값을 고정합니다. ① 탐색 에이전트(`mode: 'research'`, `researchSchema`, 도구 한도 `RESEARCH_LIMITS` 160회·600,000자 — 매니페스트 `limits`로 MCP에 전달)가 같은 프롬프트로 넓게 조사하고, 실제로 읽은 범위만 남긴 조사 결과와 그 코드 발췌를 본 요청 프롬프트에 붙입니다. ② 본 요청은 그대로 실행합니다. ③ 해설 종류면 검증된 초안을 `draft-N`으로 검토 에이전트(`mode: 'review'`, `refineSchema`)에 보내고 `applyReview`가 수정·추가·삭제·순서를 다시 검증해 반영합니다(검증 실패 항목은 초안 유지). 모든 단계의 읽기는 같은 `context`에 모이므로 앞 단계가 읽은 범위를 뒤 단계가 인용할 수 있습니다. 탐색·검토가 실패하면 경고를 남기고 일반 결과로 진행합니다. 추가 단계의 활동 id는 `research:`·`review:` 접두어, 단계 표시는 `tool: 'phase'` 활동입니다. 기록: `conversation.extended/research/review`, `job.review`.

**해설 다듬기(`refine`)**: `{ paths[], question, allowAdd, allowDelete }`. `refine.mjs#refineRequest`가 파일별 현재 해설(소스 위치 재확인)과 그 범위를 첨부하고, 에이전트는 바꾼·추가한 해설(`noteId` = 기존 id 또는 `new-N`), 삭제 목록, 파일별 해설 순서를 돌려줍니다. 수정은 같은 그룹의 새 버전(원래 질문 링크와 시각화를 이어받고, 시각화 코드 링크는 `diagramRecordId`(만든 요청)로 검증), 삭제는 소프트 삭제(작업 결과 `job.refine.removedIds`로 되돌리기), 허용되지 않은 추가·삭제와 확인하지 않은 범위는 경고로 버립니다.

### 에이전트 계약 (`agents/registry.mjs`)
```
{ id, label, loginHint, supportsUsage,
  status(): {available, authenticated, message},
  run(options) → 응답 JSON,                 // 상태 없는 요청
  sessions: { run(options), forget(key), close() },  // 채팅별 유지 세션
  listModels(), version(), usage?(force) }
options = { directory, cwd?, prompt, instructions, mode, responseSchema, model, sessionKey(chatId),
            sourceRoot, signal, onEvent({stage, partial, activity, tokenUsage}), onContext(excerpt), onSession, onProcess }
```
- 인덱스 연결: 요청마다 `agentIndex.grant`로 토큰을 만들어 `options.indexAccess = { url, token }`으로 매니페스트에 넣고, 요청이 끝나면 회수합니다. MCP 프로세스는 이 토큰으로 `POST /api/agent-index`(`files`·`candidates`·`symbols`)를 호출해 폴더를 직접 훑지 않고, `search_code`는 인덱스 후보 파일만 읽습니다. 연결이 실패하면 예전처럼 폴더 탐색·전체 스캔으로 돌아가고 `find_symbol`만 오류를 냅니다.
- 범위: 에이전트가 `within`(폴더·파일)으로 직접 고르고(`list_folders`로 구조 확인), 없으면 사용자 검색 범위 `options.searchScope`, 그것도 없으면 전체를 찾습니다. `wholeWorkspace: true`는 사용자 범위를 무시합니다. 결과의 `searchedIn`·`unknownScope`가 실제 범위와 잘못된 경로를 알려 줍니다. `read_file`은 제한하지 않습니다. 범위 안내는 지시문이 아닌 요청 프롬프트에 넣어 유지 세션에서도 매 턴 반영됩니다.
- 소스 접근은 항상 `source-mcp.mjs`(읽기 전용 MCP) → 읽은 범위는 `<directory>/source-reads.jsonl`에 감사 기록 → `readAudit()`로 수집. 문서(`read_document`)는 감사 기록하지 않으므로 근거·해설 위치가 될 수 없습니다. MCP 프로세스의 stdout은 프로토콜 전용이라 `console.log`를 stderr로 돌립니다(pdf.js 경고).
- 지시문 전달: Codex exec는 프롬프트 앞, Codex 세션은 `developerInstructions`, Claude는 `--append-system-prompt`.
- 세션: Codex는 app-server 스레드(`codex/sessions.mjs`), Claude는 채팅별 작업 폴더에서 CLI 재실행(`cli-sessions.mjs`, `--session-id/--resume`).
- 모델 목록: Codex는 app-server `model/list`(`codex/models.mjs`), Claude는 stream-json 입력의 `{type:'control_request', request:{subtype:'initialize'}}` 응답의 `models`(`claude/models.mjs`). 둘 다 메시지를 보내지 않습니다.

**에이전트 추가**: `agents/<id>/index.mjs`에 `create<Id>Agent({ store, dataDir, overrides })`를 만들고 `registry.mjs`의 `factories`에 등록합니다. 실행은 `process.mjs#runJsonLines`, MCP는 `source-scope.mjs#sourceServer`, JSON 추출은 `json-output.mjs`를 재사용합니다. 테스트는 `tests/chats-agents.test.mjs`의 Claude 예시를 따르세요. UI는 `/api/agents` 목록을 그대로 쓰므로 수정할 필요가 없습니다.

### 데이터 모델 (`reader.json`, `store/migrations.mjs` DATA_VERSION 2)
- `workspaces[]` `{ id, root, name, version, demo, folders?: [{ name, path }] }` — 추가 폴더의 파일 경로는 `<name>/…`, 기본 폴더는 접두어 없음 · `activeWorkspace` · `sessions[workspaceId]` = 클라이언트 `Session`
- `chats[]` `{ id, workspaceId, title, titleSource: auto|generated|user, createdAt, updatedAt, deletedAt? }`
- `conversations[]` 요청 기록 `{ id, kind, chatId?, agent, workspaceId, question, answer, context[], attachedFiles?[{ name, pages, chars, truncated }], extended?, research?{ summary, findings[{ topic, detail, references[] }], openQuestions[] }, review?{ summary, updated, added, removed }, diagrams, suggestedFiles, webSources, activity, model, status, ... }`
- `notes[]` 해설 구간 `{ id, groupId, revision, selected, path, start, end, hash, snapshot, title, overview, details[], summary, order, sequenceAt, agent, sourceConversationId, sourceChatId, generationId, diagrams?, diagramRecordId?, deletedAt? }`
- `settings` `{ agent, models{[agent]}, retainSession, historyCount, instructionPrompt, rolePrompt?, researchRolePrompt?, appearance, extendedThinking? }` (없으면 꺼짐)
- `agentSessions[chatId]` `{ id, provider, threadId?, root, turns? }` · `modelCatalogs[agent]`

저장: `Store.update`는 전체를 복제·직렬화해 다시 쓰므로(데스크톱에서는 입력을 전달하는 메인 프로세스에서 실행) 화면 상태(`PUT /session`)는 `Store.defer`로 메모리에 먼저 반영하고 2초 조용할 때나 다음 `update` 때 씁니다. 종료 경로는 `store.flush()`를 기다립니다.

형식을 바꾸면 `DATA_VERSION`을 올리고 `migrate()`에 멱등 단계를 추가한 뒤 마이그레이션 테스트를 작성하세요.

## 클라이언트

- `Reader.tsx`는 상태를 모으고 패널에 props로 전달합니다. 절 구분: 에이전트 → 파일/해설 → 채팅 → 교차 링크 → 폴링 → 탐색 기록 → 코드 선택 → 스크롤 연결 → 요청 → 렌더.
- 렌더 성능: `Reader`는 스크롤·마우스 올림마다 다시 그려지므로 `Markdown`(파싱이 비쌈)과 `NoteCard`는 `memo`입니다. 이들에 넘기는 콜백은 `hooks/useEventCallback`으로 고정하고 인라인 함수·매번 새 배열을 넘기지 마세요. 스크롤 위치는 `scrollPositions` ref에 모았다가 스크롤이 300ms 멈추면 세션에 저장합니다. 회귀 시험: `tests/ui/large-reader.spec.mjs`의 "never rebuild explanation cards".
- 입력·폴링: 질문 입력 칸(`Composer`)은 글자를 자체 상태에 두고 0.2초 멈춤·포커스 이탈·전송 때만 세션에 반영합니다. 종료·작업공간 전환 전에는 `lib/pending-edits`의 `flushPendingEdits`를 `flushSync`로 실행한 뒤 저장합니다(`Reader#settleEdits`). `ConversationItem`도 `memo`입니다. 폴링 훅은 응답이 같으면 상태를 바꾸지 않고(코드 인덱스·작업 상태), 준비된 코드 인덱스는 30초 간격으로만 확인합니다. 회귀 시험: "typing stays inside the composer".
- 해설 표시 순서는 `lib/notes.ts#teachingOrder`(생성 순서 → 에이전트가 정한 `order`). 라인 기준 탐색은 `findNoteAtLine`.
- 활성 채팅은 `Session.activeChatId`(`undefined`=미선택→최근 채팅, `''`=새 채팅). 질문을 보내면 서버가 채팅을 만들고 `job.chatId`로 알려 줍니다.
- 문구는 한국어. 테스트가 `aria-label`·버튼 이름을 사용하므로 바꿀 때 `tests/ui/*.spec.mjs`를 함께 검색하세요.

### 스타일 (`src/styles/`, `index.css`의 순서대로 적용)
`markdown`(표)은 마지막. `base`(토큰·전체 레이아웃·반응형) → `reading-scale` → `discovery` → `settings` → `question-panel` → `explanation` → `explorer` → `syntax` → `resize-editor` → `diagrams` → `chat`(채팅 바·목록·컨텍스트 메뉴) → `saved-notes`(저장한 해설·에이전트 설정).

## 테스트

| 명령 | 파일 | 범위 |
| --- | --- | --- |
| `npm test` | `tests/code-index.test.mjs` | C++ 심볼 추출, 검색 후보, 정의/선언 찾기, 저장 인덱스 재사용 (코어·채팅 픽스처는 `codeIndex: false`) |
| | `tests/core.test.mjs` | 소스 보호, 검증, 세션, 모델, 저장, 종료 |
| | `tests/documents.test.mjs` | 작업공간 문서 도구(PDF·Markdown, 절대 경로 변환, 감사 제외), 질문 첨부 업로드·프롬프트 전달 |
| | `tests/extended.test.mjs` | 확장된 사고: 설정, 탐색 → 답변 순서와 조사 결과 검증, 해설 검토 병합(수정·추가·삭제·순서·범위 밖 거부), 단계 실패 시 대체, 도구 한도 |
| | `tests/chats-agents.test.mjs` | 채팅·제목·삭제, 마이그레이션, 해설 순서, 저장한 해설, 에이전트·모델 선택, Claude 모델 목록·이벤트 해석, 제거된 에이전트 설정 정리, 프롬프트 |
| `npm run test:ui` | `tests/ui/*.spec.mjs`, 서버 `tests/ui-server.mjs` | Edge로 UI 시나리오. 실제 에이전트를 호출하지 않음 |
| `npm run test:desktop` | `tests/desktop.smoke.mjs` | Electron 창·내장 백엔드·종료 |
| `npm run build` | — | TypeScript 검사 + Vite 빌드 |

## 코드 인덱스

- **소스 범위(scope)**: 소스를 읽는 모든 함수(`readSource`, `makeIndex`, `searchCode`, `createSourceTools`, 코드 인덱스 워커)는 문자열 루트 대신 `{ root, folders }`(또는 작업공간 레코드)를 받습니다. 경로의 첫 구간이 추가 폴더 이름이면 그 폴더에서 읽습니다. 에이전트에는 `sourceRoot`로 이 범위가 전달되고(세션 비교는 `scopeKey`), 저장된 코드 인덱스는 기본 폴더 기준이라 폴더를 추가·제거하면 차이만 분석합니다.

- 작업공간을 열면 `service.mjs`가 워커를 시작합니다. 저장된 인덱스(`<dataDir>/code-index/<workspaceId>/`)를 먼저 불러와 바로 쓰고, 파일 크기·수정 시각이 바뀐 파일만 다시 분석합니다. 10분마다, 그리고 탐색기 새로고침·상태 표시줄 클릭 때 같은 방식으로 갱신합니다.
- 규모 참고(UE 5.6 Engine/Source, 59k 파일): 최초 빌드 약 70초, 재실행 약 10초, 심볼 130만·토큰 200만, 메모리 1~2GB.
- 심볼 추출은 컴파일러가 아닌 휴리스틱입니다. 오탐·누락은 `cpp-symbols.mjs`와 `tests/code-index.test.mjs`에서 고칩니다. 형식을 바꾸면 `store.mjs`의 `INDEX_VERSION`을 올립니다(기존 인덱스는 자동 재빌드).
- 심볼 범위(scope)는 `네임스페이스::클래스` 전체 경로입니다. 변수(멤버·전역·static 정의)와 열거자도 인덱스에 들어가며, 함수 지역 변수·매개변수는 인덱스 대신 `cpp-symbols.mjs#findLocalDeclaration`이 클릭한 줄을 감싸는 함수 안에서 찾습니다. `findSymbols`의 `context`(클릭 위치의 범위)로 같은 클래스·네임스페이스의 심볼을 먼저 정렬합니다.
- 코드 검색은 질의의 식별자 조각(3자 이상)을 포함하는 토큰의 파일만 후보로 읽고, 실제 내용으로 다시 확인합니다. 결과가 틀리지 않고 빨라지기만 합니다. 에이전트의 `search_code`·`find_symbol`도 같은 인덱스를 쓰며, `candidateFiles`·`findSymbols`는 `within` 범위를 순위 매기기 전에 적용합니다.
