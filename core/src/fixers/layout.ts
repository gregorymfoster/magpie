// Layout: make a book read like a store book and obey the reader's settings.
// Rules only, and each one leaves alone anything it isn't sure of.
//
// The biggest one: publishers pin body text to a font, a pixel size, a line
// height and black-on-white, which overrides the font, size, spacing and dark
// mode a person chose on their reader. Those go from body text; headings and
// special blocks keep their styling. Then empty spacer paragraphs, scene breaks
// made of blank lines (a visible break each, or they vanish at a page top),
// chapter titles set as plain paragraphs (real headings), hard-space indents,
// and pictures wider than the screen. Scene breaks the publisher drew (asterisks,
// an ornament) already show everywhere and are left as they are.
//
// A person can turn this off for a book ("Keep the book's own styling"); the
// plan's keepStyle skips this fixer.

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { decodeUtf8, dirname, joinPath, decodePath, relativeHref, type Book } from "../epub.ts";
import { imageSize } from "../images.ts";
import { contentDocs } from "./xhtml.ts";
import { parseCss, parseDecls, declsText, rules, writeCss, type CssNode, type Decl } from "./css.ts";
import type { Change, Fixer } from "./types.ts";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
/** Elements that hold running text, or wrap it. */
const TEXT_ELEMENTS = new Set(["body", "html", "*", "p", "div", "span", "section", "article", "main"]);
const HEADING = /^h[1-6]$/;
/** A paragraph of running text: long enough that it isn't a title, a caption or a line of verse. */
const LONG = 80;
const CHAPTER =
  /^(chapter|part|book|volume|prologue|epilogue|introduction|preface|foreword|afterword|interlude|appendix|chapitre|capítulo|capitolo|kapitel|hoofdstuk)\b.{0,70}$/isu;
const NUMERAL = /^([IVXLC]{1,7}|\d{1,3})\.?$/;
const CHAPTER_CLASS = /^(chap(ter)?([-_]?(title|head(ing)?|name|num(ber)?|no))?|heading\d?|h[1-6])$/i;

export const layout: Fixer = {
  id: "layout",
  title: "Make the book obey your reader's settings",
  run(book: Book): Change[] {
    if (!book.opfPath) return [];
    const opf = book.opf();
    const docs = parseDocs(book);
    if (!docs.length) return [];
    const changes: Change[] = [];
    const say = (message: string) => changes.push({ fixer: "layout", message });
    const touched = new Set<Doc>();

    // -- Styling that fights the reader's settings.
    const bodyClasses = textClasses(docs);
    const styled = { rules: 0, sheets: 0 };
    for (const item of opf.items().filter((i) => i.getAttribute("media-type") === "text/css")) {
      const path = opf.itemPath(item);
      if (!book.has(path)) continue;
      const src = decodeUtf8(book.files.get(path)!);
      const n = cleanSheet(src, bodyClasses);
      if (n.edits) {
        book.setText(path, n.css);
        styled.rules += n.edits;
        styled.sheets++;
      }
    }
    for (const d of docs) {
      for (const style of byTag(d.doc, "style")) {
        const n = cleanSheet(style.textContent ?? "", bodyClasses);
        if (!n.edits) continue;
        while (style.firstChild) style.removeChild(style.firstChild);
        style.appendChild(d.doc.createTextNode(`\n${n.css}\n`));
        styled.rules += n.edits;
        touched.add(d);
      }
      for (const el of byTag(d.doc, "*")) {
        const style = el.getAttribute("style");
        if (!style) continue;
        const decls = parseDecls(style);
        const body = el.localName === "body" || (TEXT_ELEMENTS.has(el.localName) && isLong(el));
        const kept = cleanDecls(decls, body ? "text" : "other", false);
        if (kept.length === decls.length) continue;
        styled.rules++;
        if (kept.length) el.setAttribute("style", declsText(kept));
        else el.removeAttribute("style");
        touched.add(d);
      }
    }
    if (styled.rules)
      say(
        `Took out the publisher's fixed fonts, sizes, line spacing and colours on body text (${plural(styled.rules, "style")}), so your reader's own font, size, spacing and dark mode work.`,
      );

    // -- Chapter titles set as plain paragraphs. First, so a blank line under a title is not taken for a break.
    let headings = 0;
    for (const d of docs) {
      const first = chapterTitle(d);
      if (!first) continue;
      const h = d.doc.createElementNS(XHTML_NS, "h2");
      for (const a of [...(first.attributes as unknown as Attr[])]) h.setAttribute(a.name, a.value);
      while (first.firstChild) h.appendChild(first.firstChild);
      first.parentNode!.replaceChild(h, first);
      headings++;
      touched.add(d);
    }
    if (headings)
      say(
        `Set ${plural(headings, "chapter title")} as ${headings === 1 ? "a real heading" : "real headings"}, so contents pages and readers' chapter jumps find ${headings === 1 ? "it" : "them"}.`,
      );

    // -- Spacer paragraphs and scene breaks.
    let gaps = 0;
    let spaced = 0;
    for (const d of docs) {
      let prevLong = false;
      let gap = false;
      for (const el of blocks(d)) {
        if (isEmpty(el)) gap = true;
        else if (isLong(el)) {
          if (prevLong) {
            gaps++;
            if (gap) spaced++;
          }
          prevLong = true;
          gap = false;
        } else prevLong = gap = false;
      }
    }
    // A book with empty paragraphs between most of its paragraphs uses them for spacing, not for breaks.
    const spacing = gaps >= 4 && spaced / gaps >= 0.4;
    let removed = 0;
    let breaks = 0;
    let indents = 0;
    for (const d of docs) {
      const list = blocks(d);
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        if (!el.parentNode) continue;
        if (isEmpty(el)) {
          // The whole run of empty blocks, decided at once.
          const run = [el];
          while (i + 1 < list.length && isEmpty(list[i + 1]) && nextBlock(run[run.length - 1]) === list[i + 1]) run.push(list[++i]);
          const before = prevBlock(run[0]);
          const after = nextBlock(run[run.length - 1]);
          if (!spacing && between(before, after)) {
            run[0].parentNode!.replaceChild(sceneBreak(d.doc), run[0]);
            breaks++;
            for (const e of run.slice(1)) e.parentNode!.removeChild(e);
            removed += run.length - 1;
          } else {
            for (const e of run) e.parentNode!.removeChild(e);
            removed += run.length;
          }
          touched.add(d);
          continue;
        }
        if (el.localName === "hr" && !el.getAttribute("class")) {
          el.setAttribute("class", "scene-break");
          touched.add(d);
        }
        if (isLong(el) && stripIndent(el)) {
          // The indent was meant: it comes back as a real one, which follows the reader's font size.
          el.setAttribute("class", [el.getAttribute("class"), "magpie-indent"].filter(Boolean).join(" "));
          indents++;
          touched.add(d);
        }
      }
    }
    if (removed) say(`Removed ${plural(removed, "empty spacer paragraph")}, so pages don't start with gaps.`);
    if (breaks)
      say(
        `Turned ${plural(breaks, "scene break")} made of blank lines into ${breaks === 1 ? "a visible break" : "visible breaks"}, so they don't vanish at the top of a page.`,
      );
    if (indents) say(`Replaced the typed-in hard-space indents of ${plural(indents, "paragraph")} with real indents.`);

    // -- Pictures fit the screen, and breaks look like breaks.
    let wide = 0;
    for (const d of docs)
      for (const img of byTag(d.doc, "img")) {
        const path = joinPath(dirname(d.path), decodePath(img.getAttribute("src") ?? ""));
        const size = book.has(path) ? imageSize(book.files.get(path)!) : null;
        if (size && size.w > 600 && size.w !== Infinity) wide++;
      }
    const ours = (el: Element) => /(^|\s)(scene-break|magpie-indent)$/.test(el.getAttribute("class") ?? "");
    const needsSheet = docs.filter((d) => byTag(d.doc, "img").length || byTag(d.doc, "*").some(ours));
    if (needsSheet.length) {
      const sheet = addSheet(book);
      for (const d of needsSheet) {
        const head = byTag(d.doc, "head")[0];
        if (!head) continue;
        const link = d.doc.createElementNS(XHTML_NS, "link");
        link.setAttribute("rel", "stylesheet");
        link.setAttribute("type", "text/css");
        link.setAttribute("href", relativeHref(d.path, sheet));
        head.appendChild(link);
        touched.add(d);
      }
    }
    if (wide) say(`Made ${plural(wide, "picture")} wider than a phone shrink to fit the screen.`);

    for (const d of touched) book.setText(d.path, new XMLSerializer().serializeToString(d.doc as never));
    return changes;
  },
};

/**
 * Spine pages whose first block is a short line set like a title but not
 * plainly a chapter heading: Magpie leaves those alone, and the check turns
 * them into a to-do when there are several.
 */
export function unsureTitles(book: Book): number {
  let n = 0;
  for (const d of parseDocs(book)) {
    if (byTag(d.doc, "*").some((e) => HEADING.test(e.localName))) continue;
    const first = blocks(d).find((b) => textOf(b));
    if (!first || HEADING.test(first.localName)) continue;
    const text = textOf(first);
    const bold = [...(first.childNodes as unknown as Node[])].filter((c) => c.nodeType === 1 || (c.nodeType === 3 && c.nodeValue?.trim()));
    if (text.length <= 60 && bold.length === 1 && bold[0].nodeType === 1 && /^(b|strong)$/.test((bold[0] as Element).localName) && longAfter(d, first) >= 3)
      n++;
  }
  return n;
}

// ---------------------------------------------------------------- documents

interface Doc {
  path: string;
  doc: Document;
}

function parseDocs(book: Book): Doc[] {
  const out: Doc[] = [];
  for (const path of contentDocs(book)) {
    let failed = false;
    const doc = new DOMParser({ onError: (level) => void (level !== "warning" && (failed = true)) }).parseFromString(
      decodeUtf8(book.files.get(path)!),
      "application/xhtml+xml",
    ) as unknown as Document;
    if (!failed && byTag(doc, "body")[0]) out.push({ path, doc });
  }
  return out;
}

const byTag = (doc: Document | Element, name: string) => [...(doc.getElementsByTagName(name) as unknown as Element[])];
const textOf = (el: Element) => (el.textContent ?? "").replace(/[\s ]+/g, " ").trim();
const isLong = (el: Element) => (el.localName === "p" || el.localName === "div") && textOf(el).length >= LONG && !hasBlocks(el);
const hasBlocks = (el: Element) =>
  [...(el.childNodes as unknown as Node[])].some((c) => c.nodeType === 1 && /^(p|div|h[1-6]|ul|ol|table|blockquote)$/.test((c as Element).localName));

/** The paragraph-level blocks of a page, in order: body's children and those of plain wrappers. */
function blocks(d: Doc): Element[] {
  const out: Element[] = [];
  const walk = (parent: Element) => {
    for (const c of [...(parent.childNodes as unknown as Node[])]) {
      if (c.nodeType !== 1) continue;
      const el = c as Element;
      if ((el.localName === "div" || el.localName === "section" || el.localName === "article" || el.localName === "main") && hasBlocks(el)) walk(el);
      else out.push(el);
    }
  };
  walk(byTag(d.doc, "body")[0]);
  return out;
}

/** An empty p or div: nothing but whitespace, hard spaces and line breaks. */
function isEmpty(el: Element): boolean {
  if (el.localName !== "p" && el.localName !== "div") return false;
  if (textOf(el)) return false;
  if (el.getAttribute("id")) return false; // something may link here
  return byTag(el, "*").every((c) => c.localName === "br" || (c.localName === "span" && !c.getAttribute("id")));
}

/** A paragraph with words in it, not a heading or a picture. */
const isText = (el: Element | null) => !!el && (el.localName === "p" || el.localName === "div") && !hasBlocks(el) && /[\p{L}\p{N}]/u.test(textOf(el));
const between = (before: Element | null, after: Element | null) => isText(before) && isText(after);

const sibling = (el: Element, dir: "previousSibling" | "nextSibling") => {
  let n = el[dir] as Node | null;
  while (n && n.nodeType !== 1) n = n[dir];
  return n as Element | null;
};
const prevBlock = (el: Element) => sibling(el, "previousSibling");
const nextBlock = (el: Element) => sibling(el, "nextSibling");

function sceneBreak(doc: Document): Element {
  const hr = doc.createElementNS(XHTML_NS, "hr");
  hr.setAttribute("class", "scene-break");
  return hr;
}

/** Hard spaces and spaces at the start of a paragraph, typed in to fake an indent. */
function stripIndent(el: Element): boolean {
  let n = el.firstChild;
  while (n && n.nodeType === 1 && !(n as Element).getAttribute("id") && (n as Element).firstChild) n = (n as Element).firstChild;
  if (!n || n.nodeType !== 3) return false;
  const v = n.nodeValue ?? "";
  const m = v.match(/^[ \t\r\n]* [  \t]*/);
  if (!m) return false;
  n.nodeValue = v.slice(m[0].length);
  return true;
}

const longAfter = (d: Doc, first: Element) => {
  const list = blocks(d);
  return list.slice(list.indexOf(first) + 1).filter(isLong).length;
};

/** The first block of a page when it is plainly a chapter title set as a paragraph. */
function chapterTitle(d: Doc): Element | null {
  if (byTag(d.doc, "*").some((e) => HEADING.test(e.localName))) return null;
  const first = blocks(d).find((b) => textOf(b));
  if (!first || (first.localName !== "p" && first.localName !== "div") || hasBlocks(first)) return null;
  const text = textOf(first);
  if (text.length > 80) return null;
  const byClass = (first.getAttribute("class") ?? "").split(/\s+/).some((c) => CHAPTER_CLASS.test(c));
  if (!(byClass || CHAPTER.test(text) || NUMERAL.test(text))) return null;
  return longAfter(d, first) >= 3 ? first : null;
}

/** Classes used mostly on paragraphs of running text, or on body: styling them styles the body text. */
function textClasses(docs: Doc[]): Set<string> {
  const uses = new Map<string, { n: number; long: number }>();
  const out = new Set<string>();
  for (const d of docs)
    for (const el of byTag(d.doc, "*"))
      for (const c of (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)) {
        if (el.localName === "body" || el.localName === "html") out.add(c);
        const u = uses.get(c) ?? { n: 0, long: 0 };
        u.n++;
        if (isLong(el) || byTag(el, "p").filter(isLong).length >= 3) u.long++;
        uses.set(c, u);
      }
  for (const [c, u] of uses) if (u.n >= 3 && u.long / u.n >= 0.6) out.add(c);
  return out;
}

// ---------------------------------------------------------------- style sheets

function cleanSheet(src: string, textClasses: Set<string>): { css: string; edits: number } {
  let nodes: CssNode[];
  try {
    nodes = parseCss(src);
  } catch {
    return { css: src, edits: 0 };
  }
  let edits = 0;
  for (const r of rules(nodes)) {
    const selectors = r.selector.split(",").map((s) => s.trim());
    const kind = selectors.every((s) => isTextSelector(s, textClasses)) ? "text" : "other";
    const page = selectors.some((s) => /^(html|body)$/i.test(lastCompound(s)));
    const kept = cleanDecls(r.decls, kind, page);
    if (kept.length !== r.decls.length || kept.some((d, i) => d.value !== r.decls[i].value)) edits++;
    r.decls = kept;
  }
  // Page margins in @page fight the reader's margin setting the same way.
  for (const n of nodes)
    if (n.kind === "at" && /^@page\b/i.test(n.prelude) && n.decls) {
      const kept = n.decls.filter((d) => !/^(margin|padding)/.test(d.prop));
      if (kept.length !== n.decls.length) edits++;
      n.decls = kept;
    }
  return edits ? { css: writeCss(nodes) + "\n", edits } : { css: src, edits: 0 };
}

const lastCompound = (sel: string) =>
  (sel.split(/\s*[\s>+~]\s*/).pop() ?? "")
    .replace(/::?[\w-]+(\([^)]*\))?/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .toLowerCase();

/** Does this selector style running text: body, plain paragraphs, or a class used on running text? */
function isTextSelector(sel: string, textClasses: Set<string>): boolean {
  const last = lastCompound(sel);
  if (/::?(first-letter|first-line|before|after)/i.test(sel)) return false;
  const el = last.match(/^([a-z][a-z0-9]*|\*)/)?.[1];
  const classes = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  if (el && !TEXT_ELEMENTS.has(el)) return false;
  if (classes.length) return classes.some((c) => textClasses.has(c.toLowerCase()) || textClasses.has(c));
  return !!el;
}

/**
 * Declarations that fight the reader's settings come out. On body text: the
 * font, its size, line height, colours and (on the page itself) margins. On
 * anything: black text and white backgrounds (they break dark mode), line
 * heights in fixed units, and fixed font sizes, which become relative ones.
 */
function cleanDecls(decls: Decl[], kind: "text" | "other", page: boolean): Decl[] {
  const out: Decl[] = [];
  for (const d of decls) {
    const v = d.value.replace(/\s*!important\s*$/i, "");
    if (kind === "text") {
      if (d.prop === "font-family" && !/^\s*monospace\s*$/i.test(v)) continue;
      if (d.prop === "font-size" || d.prop === "line-height" || d.prop === "color" || d.prop === "background-color") continue;
      if (d.prop === "font" || (d.prop === "background" && !/url\(/i.test(v))) continue;
      if (page && /^(margin|padding)(-|$)/.test(d.prop)) continue;
    }
    if (d.prop === "color" && isDark(v)) continue;
    if ((d.prop === "background-color" || d.prop === "background") && isLight(v)) continue;
    if (d.prop === "line-height" && /\d(px|pt|pc|cm|mm|in)\b/i.test(v)) continue;
    if (d.prop === "font-size") {
      const em = toEm(v);
      if (em) {
        out.push({ prop: d.prop, value: em });
        continue;
      }
    }
    out.push(d);
  }
  return out;
}

function toEm(v: string): string | null {
  const m = v.trim().match(/^(\d*\.?\d+)(px|pt)$/i);
  if (!m) return null;
  const em = Number(m[1]) / (m[2].toLowerCase() === "px" ? 16 : 12);
  return `${Math.round(em * 100) / 100}em`;
}

function rgb(v: string): [number, number, number] | null {
  const s = v.trim().toLowerCase();
  const named: Record<string, [number, number, number]> = { black: [0, 0, 0], white: [255, 255, 255], "#fff": [255, 255, 255], "#000": [0, 0, 0] };
  if (named[s]) return named[s];
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = s.match(/^#([0-9a-f]{6})$/);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = s.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}
const luma = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** Black or near-black grey. A dark colour (an oxblood heading) is a choice and stays. */
const isDark = (v: string) => {
  const c = rgb(v);
  return !!c && luma(c) < 60 && Math.max(...c) - Math.min(...c) < 30;
};
/** White or nearly. A tinted box (cream, pale grey) is part of the design and stays. */
const isLight = (v: string) => {
  const c = rgb(v);
  return !!c && luma(c) > 245 && Math.max(...c) - Math.min(...c) < 15;
};

/** Magpie's own small style sheet: pictures fit, scene breaks show. Written once per fix, in the package's folder. */
function addSheet(book: Book): string {
  const opf = book.opf();
  const path = joinPath(dirname(book.opfPath!), "magpie.css");
  if (!book.has(path)) {
    book.setText(
      path,
      [
        "/* Added by Magpie so pictures fit the screen and scene breaks show on every reader. */",
        "img { max-width: 100%; height: auto; }",
        "hr.scene-break { border: 0; border-top: 1px solid; width: 25%; margin: 1.5em auto; opacity: 0.6; }",
        ".magpie-indent { text-indent: 1.5em; }",
        "",
      ].join("\n"),
    );
    const item = opf.doc.createElementNS("http://www.idpf.org/2007/opf", "item");
    item.setAttribute("id", opf.uniqueId("magpie-css"));
    item.setAttribute("href", relativeHref(book.opfPath!, path));
    item.setAttribute("media-type", "text/css");
    opf.section("manifest").appendChild(item);
    opf.save();
  }
  return path;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
