// Heuristic C++ symbol extraction tuned for Unreal Engine sources. It is not a compiler:
// it finds type/function/macro/delegate/alias definitions and in-class declarations quickly
// enough to index ~60k files, and prefers missing a symbol over inventing one.
export const KINDS = ['class', 'struct', 'union', 'enum', 'function', 'declaration', 'macro', 'alias', 'delegate', 'variable', 'enumerator'];
export const TYPE_KINDS = new Set(['class', 'struct', 'union', 'enum', 'alias', 'delegate']);

const NOT_FUNCTIONS = new Set(['if', 'for', 'while', 'switch', 'return', 'sizeof', 'catch', 'else', 'do', 'case', 'new', 'delete', 'throw', 'alignof', 'decltype', 'static_assert', 'typeid', 'noexcept', 'co_return', 'co_await', 'co_yield', 'template', 'using', 'typedef', 'namespace', 'alignas', 'requires', 'defined', '__declspec', '__attribute__']);
const TYPE_LINE = /^(?:template\s*<.*>\s*)?(?:typedef\s+)?(class|struct|union|enum(?:\s+(?:class|struct))?)\s+((?:[A-Z][A-Z0-9_]*_API|alignas\s*\([^)]*\)|\[\[[^\]]*\]\]|DEPRECATED\([^)]*\)|UE_DEPRECATED\([^)]*\))\s+)*([A-Za-z_]\w*)\s*(?:final\b)?\s*(?::(?!:)[^;{]*)?(\{.*)?$/;
const FUNCTION_NAME = /(~?[A-Za-z_]\w*(?:\s*::\s*~?[A-Za-z_]\w*)*|operator\s*(?:\(\)|[^\s(]+))\s*\(/g;
const DELEGATE = /^(?:DECLARE_(?:DYNAMIC_)?(?:MULTICAST_)?(?:SPARSE_)?(?:TS_)?DELEGATE\w*|DECLARE_(?:DERIVED_)?EVENT\w*)\s*\(\s*([^,)\s]+)\s*(?:,\s*([A-Za-z_]\w*))?/;

// Blank comments, string and char literals (keeping newlines and the quote marks) so braces and
// parentheses inside them never count.
export function stripCode(text) {
  let out = '', i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === '/' && d === '/') { while (i < n && text[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') { out += '  '; i += 2; while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++; } if (i < n) { out += '  '; i += 2; } continue; }
    if (c === 'R' && d === '"' && !/\w/.test(text[i - 1] || '')) {
      const open = text.indexOf('(', i + 2), delimiter = text.slice(i + 2, open);
      const close = open < 0 || delimiter.length > 16 ? -1 : text.indexOf(`)${delimiter}"`, open);
      if (close >= 0) { const end = close + delimiter.length + 2; out += 'R"' + text.slice(i + 2, end - 1).replace(/[^\n]/g, ' ') + '"'; i = end; continue; }
    }
    if (c === '"' || (c === "'" && !(/[0-9a-fA-F]/.test(text[i - 1] || '') && /[0-9a-fA-F]/.test(d || '')))) {
      out += c; i++;
      while (i < n && text[i] !== c && text[i] !== '\n') { if (text[i] === '\\') { out += ' '; i++; } out += ' '; i++; }
      if (i < n && text[i] === c) { out += c; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

// From an opening parenthesis, find whether a declarator ends in a body ('{', or ':' init list),
// ';' (declaration), or is a variable initialized with literal arguments: FAutoConsoleVariableRef CVar(TEXT("a"), ...);
function declaratorEnd(code, open) {
  let depth = 0, i = open;
  for (; i < code.length && i - open < 4000; i++) {
    const c = code[i];
    if (c === '(') depth++;
    else if (c === ')') { if (--depth === 0) { i++; break; } }
    else if ((c === '{' || c === ';') && depth === 0) return null;
  }
  const args = code.slice(open + 1, i - 1);
  // Literal arguments without `Type Name` parameters are an initialization, not a parameter list.
  if (args.includes('"') && !/[A-Za-z_][\w:<>]*[\s*&]+[A-Za-z_]\w*\s*(?:=|,|$)/.test(args.trim())) return /^\s*[;,]/.test(code.slice(i, i + 40)) ? 'variable' : null;
  // Skip qualifiers and trailing return types up to the deciding token.
  for (let angle = 0, paren = 0; i < code.length && i - open < 6000; i++) {
    const c = code[i];
    if (c === '(') paren++; else if (c === ')') paren--;
    else if (c === '<') angle++; else if (c === '>') angle = Math.max(0, angle - 1);
    else if (paren === 0 && angle === 0) {
      if (c === '{') return 'function';
      if (c === ';') return 'declaration';
      if (c === ':' && code[i + 1] !== ':' && code[i - 1] !== ':') return 'function';
      if (c === ',' || c === '}') return null;
      if (c === '=') { const rest = code.slice(i + 1, i + 24).trim(); return /^(0|default|delete)\b/.test(rest) ? 'declaration' : null; }
    }
  }
  return null;
}

// [specifiers/macros] Type [<...>] [*&const] Name[::Name] [array] [: bits] (= | ; | { | ,)
const VARIABLE = /^((?:(?:static|inline|constexpr|constinit|const|extern|mutable|thread_local|volatile|struct|class|enum|union)\s+|[A-Z][A-Z0-9_]*(?:\s*\([^()]*\))?\s+)*)((?:[A-Za-z_]\w*\s*::\s*)*[A-Za-z_]\w*(?:\s*<[^;{}()]*>)?(?:\s*::\s*[A-Za-z_]\w*)*(?:\s*(?:\*|&|\bconst\b))*)\s+((?:[A-Za-z_]\w*::)*[A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)*(?::\s*\d+\s*)?(?:=|;|\{|,)/;
const NOT_TYPES = new Set(['return', 'delete', 'goto', 'case', 'using', 'typedef', 'friend', 'public', 'private', 'protected', 'else', 'throw', 'new', 'co_return', 'template', 'operator', 'class', 'struct', 'enum', 'union', 'namespace', 'virtual', 'explicit', 'typename']);
const NOT_NAMES = new Set(['override', 'final', 'const', 'noexcept', 'default', 'delete', 'public', 'private', 'protected']);

function enumerators(text) {
  return text.replace(/\b[A-Z][A-Z0-9_]*\s*\([^()]*\)/g, ' ').split(',').flatMap(part => { const m = /^\s*([A-Za-z_]\w*)\s*(?:=|$)/.exec(part); return m ? [m[1]] : []; });
}

/**
 * @returns {{ name: string, kind: string, line: number, scope: string }[]}
 * With { stopAt } returns the context at that line instead: { scope, fn: { name, scope, line } | null }.
 * scope is the full named chain (namespaces, classes, enums), e.g. 'UE::GC::FWorkCoordinator'.
 */
export function extractSymbols(text, { stopAt } = {}) {
  const code = stripCode(text), lines = code.split('\n'), symbols = [];
  const scopes = []; // { kind: 'class'|'enum'|'namespace'|'function'|'block', name, depth, scope?, line? }
  let depth = 0, pending = null, macro = false, offset = 0;
  const chain = () => scopes.filter(s => (s.kind === 'class' || s.kind === 'enum' || s.kind === 'namespace') && s.name).map(s => s.name).join('::');
  const within = qualifier => { const base = chain(); return qualifier ? (base ? `${base}::${qualifier}` : qualifier) : base; };
  const add = (name, kind, line, scope = chain()) => symbols.push({ name, kind, line, scope });
  for (let index = 0; index < lines.length; offset += lines[index].length + 1, index++) {
    const raw = lines[index], line = raw.trim(), lineNo = index + 1;
    if (stopAt === lineNo) { const fn = scopes.filter(s => s.kind === 'function').at(-1); return { scope: chain(), fn: fn ? { name: fn.name, scope: fn.scope, line: fn.line } : null }; }
    if (macro || line.startsWith('#')) {
      const define = !macro && /^#\s*define\s+([A-Za-z_]\w*)/.exec(line);
      if (define) add(define[1], 'macro', lineNo, '');
      macro = raw.trimEnd().endsWith('\\');
      continue;
    }
    const top = scopes.at(-1);
    const declarative = !top || top.kind === 'class' || top.kind === 'namespace';
    if (top?.kind === 'enum' && line) for (const name of enumerators(line.replace(/[{}]/g, ' '))) add(name, 'enumerator', lineNo);
    else if (declarative && line) {
      const type = TYPE_LINE.exec(line);
      const delegate = !type && DELEGATE.exec(line);
      if (type && !(line.includes(';') && !line.includes('{'))) {
        const kind = type[1].startsWith('enum') ? 'enum' : type[1];
        add(type[3], line.startsWith('typedef') ? 'alias' : kind, lineNo);
        pending = { kind: kind === 'enum' ? 'enum' : 'class', name: type[3] };
        const body = kind === 'enum' && /\{([^}]*)\}?/.exec(line)?.[1];
        if (body) for (const name of enumerators(body)) add(name, 'enumerator', lineNo, within(type[3]));
      } else if (delegate) {
        // RetVal delegates and events name the type in the second argument.
        const name = /EVENT|RetVal/.test(line.slice(0, line.indexOf('('))) && delegate[2] ? delegate[2] : delegate[1];
        if (/^[A-Za-z_]\w*$/.test(name)) add(name, 'delegate', lineNo);
      } else if (/^namespace\b/.test(line) || /^extern\s+"\s*"\s*\{?$/.test(line)) {
        pending = { kind: 'namespace', name: /^namespace\s+([\w:]+)/.exec(line)?.[1] || '' };
      } else if (/^using\s+([A-Za-z_]\w*)\s*=/.test(line)) add(/^using\s+([A-Za-z_]\w*)/.exec(line)[1], 'alias', lineNo);
      else if (/^typedef\b/.test(line)) {
        const name = /\(\s*\*\s*([A-Za-z_]\w*)\s*\)/.exec(line)?.[1] || /([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;\s*$/.exec(line)?.[1];
        if (name) add(name, 'alias', lineNo);
      } else {
        FUNCTION_NAME.lastIndex = 0;
        let match = FUNCTION_NAME.exec(raw), kind = null;
        // Reflection macros may precede a declaration on the same line: UFUNCTION(...) void Foo();
        while (match && /^[A-Z][A-Z0-9_]*$/.test(match[1])) match = FUNCTION_NAME.exec(raw);
        if (match) {
          const full = match[1].replace(/\s+/g, ''), parts = full.split('::'), name = parts.at(-1), qualifier = parts.slice(0, -1).join('::');
          const prefix = raw.slice(0, match.index).replace(/\b[A-Z][A-Z0-9_]*\s*\([^()]*\)/g, ' ').trim();
          const owner = scopes.filter(s => s.kind === 'class').at(-1)?.name;
          const constructor = owner && (name === owner || name === `~${owner}`);
          const plausible = !NOT_FUNCTIONS.has(name) && !/^[A-Z][A-Z0-9_]*$/.test(name) && /^[\w\s:<>,*&~\[\]]*$/.test(prefix) && !/\b(return|throw|case)\b/.test(prefix) && !/^[:,]/.test(prefix)
            && (prefix.length > 0 || qualifier || constructor || name.startsWith('operator'));
          kind = plausible ? declaratorEnd(code, offset + match.index + match[0].length - 1) : null;
          if (kind) add(name, kind, lineNo, within(qualifier));
          // The next '{' opens this function's body: locals below are scoped to it.
          if (kind === 'function') pending = { kind: 'function', name, scope: within(qualifier), line: lineNo };
        }
        const variable = !kind && VARIABLE.exec(line);
        if (variable) {
          const typeHead = variable[2].trim().split(/[\s<:*&]/)[0], parts = variable[3].split('::'), name = parts.at(-1);
          if (!NOT_TYPES.has(typeHead) && !NOT_NAMES.has(name) && !NOT_FUNCTIONS.has(name)) add(name, 'variable', lineNo, within(parts.slice(0, -1).join('::')));
        }
      }
    }
    for (const c of raw) {
      if (c === '{') { depth++; scopes.push({ ...(pending || { kind: 'block', name: '' }), depth }); pending = null; }
      else if (c === '}') { depth = Math.max(0, depth - 1); while (scopes.length && scopes.at(-1).depth > depth) scopes.pop(); }
      else if (c === ';' && pending && pending.kind !== 'namespace') pending = null;
    }
  }
  if (stopAt) { const fn = scopes.filter(s => s.kind === 'function').at(-1); return { scope: chain(), fn: fn ? { name: fn.name, scope: fn.scope, line: fn.line } : null }; }
  return symbols;
}

// Declarations of a function's parameters and locals: `Type Name =|;|,|)|(|{|:|[`, newest first.
const LOCAL_DECLARATION = name => new RegExp(`(?:^|[\\s(,;{])(?:const\\s+|static\\s+|constexpr\\s+)*((?:[A-Za-z_]\\w*\\s*::\\s*)*[A-Za-z_]\\w*(?:\\s*<[^;{}()]*>)?)(?:\\s*(?:\\*|&|\\bconst\\b))*\\s*[\\s*&]\\s*${name}\\s*(?:=|;|,|\\)|\\(|\\{|:(?!:)|\\[)`);
const NOT_LOCAL_TYPES = new Set([...NOT_TYPES, 'if', 'while', 'for', 'switch', 'sizeof', 'co_await', 'co_yield', 'static_cast', 'const_cast', 'dynamic_cast', 'reinterpret_cast', 'Cast', 'CastChecked']);

/** Parameter or local variable declaration of `name` visible at `line` (1-based), or null. */
export function findLocalDeclaration(text, line, name) {
  if (!/^[A-Za-z_]\w*$/.test(name)) return null;
  const context = extractSymbols(text, { stopAt: line });
  if (!context.fn) return null;
  const lines = stripCode(text).split('\n'), pattern = LOCAL_DECLARATION(name);
  // Same line first (e.g. `for (auto& Item : Items)`), then upwards to the function signature.
  for (let n = line; n >= context.fn.line; n--) {
    const match = pattern.exec(lines[n - 1] || '');
    if (match && !NOT_LOCAL_TYPES.has(match[1].trim().split(/[\s<:]/)[0])) return { name, line: n, function: context.fn };
  }
  return null;
}

// Distinct lower-case identifier runs (3+ chars) of the raw text, comments and strings included,
// so a search query's identifier runs can narrow candidate files without missing matches.
export function extractTokens(text) {
  return new Set(text.toLowerCase().match(/[a-z0-9_]{3,}/g) || []);
}
