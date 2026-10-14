# CLAUDE.md

이 저장소의 작업 규칙은 `AGENTS.md`에 있습니다. 반드시 먼저 따르세요.

@AGENTS.md

## Claude Code 참고

- 기능 수정 전에 `Docs/CODE_INDEX.md`에서 관련 파일만 골라 읽습니다. 넓은 범위를 모를 때만 Grep으로 심볼을 찾고, 전체 디렉터리를 순서대로 읽지 마세요.
- 이 앱 자체도 Claude Code를 에이전트로 호출합니다(`server/agents/claude/index.mjs`). 그 호출은 `--tools WebSearch,WebFetch`, `--permission-mode dontAsk`, `--strict-mcp-config`, `--setting-sources ""`로 제한합니다. 이 제한을 완화하지 마세요.
- 실제 Claude 호출로 확인할 때는 저렴한 모델(`--model haiku`)과 임시 데이터 폴더를 사용하고, 결과를 사용자에게 요약해 보고합니다.
