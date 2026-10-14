import { useCallback, useRef } from 'react';

// A function with a stable identity that always calls the latest handler. Passing these to memoized
// children (explanation cards, Markdown) lets them skip re-rendering when only the parent changed.
export function useEventCallback<A extends unknown[], R>(handler: (...args: A) => R) {
  const latest = useRef(handler);
  latest.current = handler;
  return useCallback((...args: A) => latest.current(...args), []);
}
