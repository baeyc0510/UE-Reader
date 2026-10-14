import { memo, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];

function sourceLink(url: string) {
  const value = url.startsWith('source:') ? url.slice(7) : url;
  const match = value.match(/^(.+\.(?:cpp|h|hpp|cc|c|inl|cs|usf|ush))(?:(?:#L|:)(\d+)(?:[-–](?:L)?\d+)?)?$/i);
  if (!match || /^[\\/]/.test(match[1]) || match[1].includes(':') || match[1].split(/[\\/]/).includes('..')) return null;
  return { path: match[1], line: Number(match[2]) || 1 };
}
const urlTransform = (url: string) => /^https?:\/\//i.test(url) || sourceLink(url) ? url : '';

// Parsing is the expensive part, so the component is memoized: pass a stable `navigate`
// (hooks/useEventCallback) and unchanged text never re-parses. Stable `components` also keep
// React from remounting links and tables on every render.
export const Markdown = memo(function Markdown({ text, navigate }: { text: string; navigate: (path: string, line?: number) => void }) {
  const components = useMemo<Components>(() => ({
    a: ({ href, children }) => {
      const source = href ? sourceLink(href) : null;
      if (source) return <button className="inline-link" onClick={() => navigate(source.path, source.line)}>{children}</button>;
      if (href && /^https?:\/\//i.test(href)) return <a className="inline-link" href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
      return <span>{children}</span>;
    },
    img: ({ alt }) => <span>{alt}</span>,
    table: ({ children }) => <div className="md-table"><table>{children}</table></div>,
  }), [navigate]);
  // GFM adds tables, strikethrough and task lists, which agents use for comparisons and steps.
  return <ReactMarkdown remarkPlugins={plugins} urlTransform={urlTransform} components={components}>{text}</ReactMarkdown>;
});
