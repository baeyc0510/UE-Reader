# AGENTS.md

UE Reader: Unreal Engine 소스를 읽기 전용으로 열고, 로컬 에이전트 CLI(Codex · Claude Code)로 질문 답변과 코드 해설을 만드는 Windows 데스크톱 앱(Electron + Express + React).

## 작업 시작 방법

1. **전체 소스를 읽지 마세요.** 먼저 [`Docs/CODE_INDEX.md`](Docs/CODE_INDEX.md)의 “기능별 진입점” 표에서 바꾸려는 기능의 파일을 찾고, 그 파일과 “함께 볼 파일”만 읽습니다.
2. 파일 첫머리 주석에 그 모듈의 책임과 계약이 있습니다. 주석과 인덱스가 다르면 코드를 기준으로 하고 인덱스를 고칩니다.
3. 동작 설명은 `README.md`(소개·설치·실행)와 `Docs/사용-가이드.md`(화면 동작·처리 한도, 사용자 관점), 기획 배경은 `Docs/기획서.md`, 분석 품질 기록은 `Docs/분석-개선-*.md`에 있습니다. 필요할 때만 읽으세요.
4. 생성물은 읽거나 고치지 마세요: `dist/`, `release/`, `.runtime/`, `test-results/`, `node_modules/`, `.runtime/protocol/`(Codex 프로토콜 타입 덤프).

## 구조 규칙

- 서버 계층: `routes/`(HTTP 검증·응답만) → `analysis/`(요청 파이프라인) → `domain/`(순수 규칙) · `agents/`(CLI 어댑터) · `source/`(읽기 전용 소스) · `store/`(저장).
- 에이전트별 차이는 `server/agents/<id>/`에만 둡니다. 다른 계층에서 `if (agent === 'claude')` 같은 분기를 만들지 마세요. 공통 기능은 `agents/process.mjs`, `source-scope.mjs`, `json-output.mjs`, `cli-sessions.mjs`에 둡니다.
- 모델에 보내는 문구는 `server/analysis/prompts.mjs`에만 둡니다. 지침을 바꾸면 `PROMPT_VERSION`을 올립니다.
- 응답 형식은 `server/analysis/schemas.mjs`(엄격한 JSON Schema: 모든 필드 required, additionalProperties false). 필드를 바꾸면 `results.mjs`와 `src/types.ts`도 맞춥니다.
- 저장 형식을 바꾸면 `store/migrations.mjs`에 멱등 마이그레이션을 추가합니다.
- 클라이언트: 화면 조립과 패널 간 동작은 `src/Reader.tsx`, 표현은 `src/components/<영역>/`, 서버 상태 훅은 `src/hooks/`, 순수 함수는 `src/lib/`. 컴포넌트는 API를 직접 부르기보다 props 콜백을 받습니다(설정 패널처럼 자체 목록을 불러오는 경우 제외).
- 새 파일을 만들거나 책임을 옮기면 `Docs/CODE_INDEX.md`를 갱신합니다.

## 지켜야 할 제품 규칙

- 소스는 읽기 전용입니다. 에이전트에게는 `server/agents/source-tools.mjs`의 `search_files`·`search_code`·`read_file`과 웹 검색만 허용합니다. 셸·쓰기·플러그인·훅을 켜지 마세요.
- 해설·근거·시각화 링크는 에이전트가 **실제로 읽은 범위**(`source/inspected-ranges.mjs`)로만 저장합니다. 검증 실패 항목은 버리고 경고로 남깁니다.
- 질문에는 사용자가 명시적으로 선택한 코드만 첨부합니다(화면 코드 자동 첨부 금지).
- 질문·답변은 채팅 단위로 저장되고, 이전 대화는 같은 채팅에서만 전달합니다. 사용자가 바꾼 채팅 제목(`titleSource: 'user'`)은 덮어쓰지 않습니다.
- 해설은 에이전트가 정한 **해설 순서**(`order`)로 표시합니다. 라인 순 정렬로 되돌리지 마세요.
- 개발 용어는 직역하지 않습니다(GC, 리플렉션, 델리게이트 …). 규칙은 `prompts.mjs`의 terminology 절.
- 서버는 `127.0.0.1`만 바인딩하고 외부 Origin·Host를 거부합니다(`http/security.mjs`).
- UI 문구는 한국어입니다. 버튼·`aria-label` 이름은 UI 시험이 사용하므로 바꾸면 `tests/ui/`를 함께 수정합니다.

## 코드 스타일

- ESM(`.mjs`), Node 20.18+, 서버는 의존성 최소(Express, PDF 텍스트 추출용 `pdfjs-dist`만). 클라이언트는 React 18 + TypeScript strict.
- 기존 코드처럼 간결하게: 짧은 함수, 이른 반환, 한 줄 조건문 허용. 주석은 “왜”만 짧게 영어로.
- 사용자에게 보이는 오류는 `fail(message, status)`로 한국어 메시지를 던집니다.

## 검증

```powershell
npm test            # 서버 코어·채팅·에이전트 (실제 CLI 호출 없음)
npm run build       # 타입 검사 + 프런트엔드 빌드
npm run test:ui     # Edge UI 시험 (포트 4318, 임시 데이터)
npm run test:desktop
npm run package:desktop   # release/win-unpacked 갱신. 끝나면 배포본이 server/dist/desktop과 같은지 검사하며, 실행 중인 UE Reader가 파일을 잡고 있으면 실패합니다(앱을 종료하고 다시 실행).
```

변경 범위에 맞는 시험을 실행하고, 실패를 숨기지 말고 보고합니다. 실제 에이전트 호출 검증이 필요하면 별도 임시 데이터 폴더(`UE_READER_DATA`)를 쓰고 사용자 데이터(`%LOCALAPPDATA%\UEReader`)를 건드리지 마세요.
