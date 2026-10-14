export {};
declare global {
  interface Window { ueReader?: { onCloseRequested: (callback: () => void) => () => void }; }
}
