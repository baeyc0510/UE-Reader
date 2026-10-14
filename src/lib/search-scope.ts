// Agent search scope (Session.searchScope): workspace folders or files the agent's search tools cover
// by default. Empty means the whole workspace. Entries never nest: a folder replaces the entries inside it.
const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);
export const coveredBy = (scope: string[], path: string) => scope.find(entry => within(path, entry));
export function addToScope(scope: string[], path: string) {
  if (coveredBy(scope, path)) return scope;
  return [...scope.filter(entry => !within(entry, path)), path];
}
export const removeFromScope = (scope: string[], path: string) => scope.filter(entry => entry !== path);
