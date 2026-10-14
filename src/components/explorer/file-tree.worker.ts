export type TreeRow = { path: string; name: string; folder: boolean; depth: number; open: boolean };
type Node = { path: string; name: string; children?: Map<string, Node>; sorted?: Node[] };
let root: Node = { path: '', name: '', children: new Map() };
let paths: string[] = [], previousQuery = '', matches: Set<string> | null = null;
function build(files: string[]) {
  paths = files;
  root = { path: '', name: '', children: new Map() };
  for (const file of files) {
    const parts = file.split('/'); let node = root, path = '';
    parts.forEach((name, i) => {
      path = path ? `${path}/${name}` : name;
      if (!node.children!.has(name)) node.children!.set(name, { name, path, ...(i < parts.length - 1 ? { children: new Map() } : {}) });
      node = node.children!.get(name)!;
    });
  }
  const collator = new Intl.Collator(undefined, { numeric: true });
  function sort(node: Node) {
    if (!node.children) return;
    node.sorted = [...node.children.values()].sort((a, b) => Number(!a.children) - Number(!b.children) || collator.compare(a.name, b.name));
    node.sorted.forEach(sort);
  }
  sort(root); matches = null;
}
self.onmessage = ({ data }: MessageEvent<{ serial: number; files?: string[]; expanded: string[]; filter: string; filterClosed: string[] }>) => {
  if (data.files) build(data.files);
  const query = data.filter.trim().toLowerCase();
  if (query && (!matches || previousQuery !== query)) {
    matches = new Set();
    for (const path of paths) if (path.toLowerCase().includes(query)) {
      matches.add(path);
      let end = path.lastIndexOf('/');
      while (end !== -1) { matches.add(path.slice(0, end)); end = path.lastIndexOf('/', end - 1); }
    }
  }
  previousQuery = query;
  const expanded = new Set(data.expanded), filterClosed = new Set(data.filterClosed), rows: TreeRow[] = [];
  function visit(node: Node, depth: number) {
    for (const child of node.sorted || []) {
      if (query && !matches!.has(child.path)) continue;
      const open = !!child.children && (query ? !filterClosed.has(child.path) : expanded.has(child.path));
      rows.push({ path: child.path, name: child.name, folder: !!child.children, depth, open });
      if (open) visit(child, depth + 1);
    }
  }
  visit(root, 0);
  self.postMessage({ serial: data.serial, rows });
};
