import { Component, type ReactNode } from 'react';

// A rendering error shows a recovery screen instead of a blank window. Saved data stays on disk.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="welcome boot-screen" role="alert"><h1>화면을 표시하지 못했습니다.</h1><p>저장된 작업공간과 해설은 그대로 남아 있습니다.<br/>다시 불러와도 같은 문제가 반복되면 아래 내용을 알려 주세요.</p>
      <pre className="boot-error">{this.state.error.message}</pre><button className="primary" onClick={() => location.reload()}>다시 불러오기</button></main>;
  }
}
