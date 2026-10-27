// Just enough CSS to edit a publisher's style sheet without breaking it: rules
// with their selectors and declarations, at-rules kept whole or walked into
// (@media, @supports), comments dropped. Not a validator. Anything it can't
// follow is kept as raw text and written back unchanged.

export interface Decl {
  prop: string;
  value: string;
}

export type CssNode =
  | { kind: "rule"; selector: string; decls: Decl[] }
  /** @media and @supports: a prelude and the rules inside. */
  | { kind: "block"; prelude: string; body: CssNode[] }
  /** Everything else (@font-face, @page, @import, @charset, text it couldn't follow), with its declarations when it has a block. */
  | { kind: "at"; prelude: string; decls: Decl[] | null }
  | { kind: "raw"; text: string };

export function parseCss(src: string): CssNode[] {
  const s = stripComments(src);
  const out: CssNode[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const head = scan(s, i, ";{}");
    if (head.at >= s.length) {
      out.push({ kind: "raw", text: s.slice(i).trim() });
      break;
    }
    const prelude = s.slice(i, head.at).trim();
    if (s[head.at] === ";") {
      out.push({ kind: "at", prelude, decls: null });
      i = head.at + 1;
      continue;
    }
    if (s[head.at] === "}") {
      // A stray close brace: skip it.
      i = head.at + 1;
      continue;
    }
    const end = matching(s, head.at);
    const inner = s.slice(head.at + 1, end);
    if (/^@(media|supports|document|layer)\b/i.test(prelude)) out.push({ kind: "block", prelude, body: parseCss(inner) });
    else if (prelude.startsWith("@")) out.push({ kind: "at", prelude, decls: parseDecls(inner) });
    else out.push({ kind: "rule", selector: prelude, decls: parseDecls(inner) });
    i = end + 1;
  }
  return out;
}

export function parseDecls(s: string): Decl[] {
  const out: Decl[] = [];
  for (const part of split(s, ";")) {
    const c = part.indexOf(":");
    if (c < 0) continue;
    const prop = part.slice(0, c).trim().toLowerCase();
    const value = part.slice(c + 1).trim();
    if (prop && value) out.push({ prop, value });
  }
  return out;
}

export const declsText = (d: Decl[]) => d.map((x) => `${x.prop}: ${x.value}`).join("; ");

export function writeCss(nodes: CssNode[], indent = ""): string {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.kind === "rule") {
      if (n.decls.length) out.push(`${indent}${n.selector} {\n${n.decls.map((d) => `${indent}  ${d.prop}: ${d.value};`).join("\n")}\n${indent}}`);
    } else if (n.kind === "block") {
      const body = writeCss(n.body, indent + "  ");
      if (body.trim()) out.push(`${indent}${n.prelude} {\n${body}\n${indent}}`);
    } else if (n.kind === "at") {
      if (n.decls === null) out.push(`${indent}${n.prelude};`);
      else if (n.decls.length) out.push(`${indent}${n.prelude} {\n${n.decls.map((d) => `${indent}  ${d.prop}: ${d.value};`).join("\n")}\n${indent}}`);
    } else out.push(n.text);
  }
  return out.join("\n");
}

/** Every rule, inside @media blocks too. */
export function* rules(nodes: CssNode[]): Generator<Extract<CssNode, { kind: "rule" }>> {
  for (const n of nodes) {
    if (n.kind === "rule") yield n;
    else if (n.kind === "block") yield* rules(n.body);
  }
}

function stripComments(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      const j = endOfString(s, i);
      out += s.slice(i, j);
      i = j;
    } else if (ch === "/" && s[i + 1] === "*") {
      const j = s.indexOf("*/", i + 2);
      i = j < 0 ? s.length : j + 2;
      out += " ";
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function endOfString(s: string, i: number): number {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "\\") j++;
    else if (s[j] === q || s[j] === "\n") return j + 1;
  }
  return s.length;
}

/** The first of `stops` at nesting depth 0 from i, skipping strings and parentheses. */
function scan(s: string, i: number, stops: string): { at: number } {
  let depth = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      i = endOfString(s, i);
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && stops.includes(ch)) return { at: i };
    i++;
  }
  return { at: s.length };
}

function matching(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      i = endOfString(s, i) - 1;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return s.length;
}

function split(s: string, sep: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= s.length) {
    const { at } = scan(s, i, sep);
    out.push(s.slice(i, at));
    i = at + 1;
  }
  return out;
}
