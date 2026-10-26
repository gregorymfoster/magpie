// What a book looks like on a reader, one chapter at a time. The core hands
// the window a self-contained HTML page per chapter: the book's own styles
// inlined, its pictures and fonts as data: URLs, scripts and links taken out.
// The window lays that page out at a reader's screen size (ui/src/preview.ts).
//
// Works on a fixed book and on its untouched original, so a person can see
// what a fix changed. A locked book's text is encrypted, so it has no preview.

import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import { Book, BookError, byLocal, decodePath, decodeUtf8, dirname, extOf, joinPath, MEDIA_TYPES, textOf } from "./epub.ts";
import { DOMParser } from "@xmldom/xmldom";
import { UserError } from "./errors.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export interface Preview {
  /** Every page of the reading order, with the contents' name for it where the book has one. */
  chapters: { title: string }[];
  /** Which one `html` is, after clamping to the book's length. */
  chapter: number;
  /** A whole HTML document for an iframe's srcdoc. Inert: no scripts, no links, no outside requests. */
  html: string;
}

/** A picture or font bigger than this stays out of the preview rather than slowing it down. */
const MAX_ASSET = 8_000_000;

export function loadForPreview(bytes: Uint8Array): Book {
  try {
    return Book.load(bytes);
  } catch (e) {
    if (e instanceof BookError) throw new UserError(e.code === "drm" ? "locked-preview" : e.code);
    throw e;
  }
}

/** Zip paths of the reading order. An original with no usable package falls back to its pages in zip order. */
export function readingOrder(book: Book): string[] {
  if (book.opfPath) {
    try {
      const opf = book.opf();
      const paths = opf
        .itemrefs()
        .map((r) => opf.itemById(r.getAttribute("idref") ?? ""))
        .filter((i): i is NonNullable<typeof i> => !!i)
        .map((i) => opf.itemPath(i))
        .filter((p) => book.has(p) && /\.(x?html?|xml)$/i.test(p));
      if (paths.length) return [...new Set(paths)];
    } catch {
      // a package too broken to read: fall through to the files themselves
    }
  }
  return book.entries.map((e) => e.name).filter((p) => /\.x?html?$/i.test(p) && book.has(p) && !/(^|\/)nav\.x?html?$/i.test(p));
}

/** Contents names by zip path, from the EPUB 3 nav or the NCX. The first name for a file wins. */
function contentsNames(book: Book): Map<string, string> {
  const names = new Map<string, string>();
  const add = (from: string, href: string, label: string) => {
    const p = joinPath(dirname(from), decodePath(href.split("#")[0]));
    if (label && !names.has(p)) names.set(p, label);
  };
  if (!book.opfPath) return names;
  try {
    const opf = book.opf();
    const nav = opf.items().find((i) => /\bnav\b/.test(i.getAttribute("properties") ?? ""));
    const navPath = nav && opf.itemPath(nav);
    if (navPath && book.has(navPath)) {
      const doc = parse(book.text(navPath));
      for (const a of all(doc, "a")) add(navPath, attr(a, "href") ?? "", text(a));
    }
    const ncx = opf.items().find((i) => i.getAttribute("media-type") === "application/x-dtbncx+xml");
    const ncxPath = ncx && opf.itemPath(ncx);
    if (ncxPath && book.has(ncxPath)) {
      const doc = new DOMParser().parseFromString(decodeUtf8(book.files.get(ncxPath)!), "application/xml") as unknown as Document;
      for (const np of byLocal(doc, "navPoint")) {
        const label = textOf(byLocal(np, "text")[0]);
        const src = byLocal(np, "content")[0]?.getAttribute("src") ?? "";
        add(ncxPath, src, label);
      }
    }
  } catch {
    // no names is fine
  }
  return names;
}

export function preview(book: Book, chapter: number): Preview {
  const order = readingOrder(book);
  if (!order.length) throw new UserError("preview-empty");
  const names = contentsNames(book);
  const chapters = order.map((p, i) => ({ title: names.get(p) ?? headingOf(book, p) ?? `Section ${i + 1}` }));
  const at = Math.max(0, Math.min(order.length - 1, Math.floor(chapter) || 0));
  return { chapters, chapter: at, html: page(book, order[at]) };
}

/** The first heading of a page, for a reading-order entry the contents don't name. Cheap: no parse. */
function headingOf(book: Book, path: string): string | undefined {
  const m = decodeUtf8(book.files.get(path)!).match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
  const t = m?.[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return t ? t.slice(0, 80) : undefined;
}

function page(book: Book, path: string): string {
  const doc = parse(decodeUtf8(book.files.get(path)!).replace(/^\s*<\?xml[^>]*\?>/, ""));
  const dataUrl = (from: string, href: string): string | null => {
    if (/^data:/i.test(href)) return href;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null; // nothing leaves the Mac
    const p = joinPath(dirname(from), decodePath(href.split(/[#?]/)[0]));
    const bytes = book.files.get(p);
    if (!bytes || bytes.length > MAX_ASSET) return null;
    return `data:${MEDIA_TYPES[extOf(p)] ?? "application/octet-stream"};base64,${base64(bytes)}`;
  };
  const css = (from: string, s: string) =>
    s.replace(/@import[^;]*;/gi, "").replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_, q, href) => {
      const u = dataUrl(from, href.trim());
      return u ? `url("${u}")` : "none";
    });

  const html = all(doc, "html")[0];
  const head = all(doc, "head")[0];
  for (const el of all(doc)) {
    // Scripts and anything that could fetch or navigate go; the iframe is sandboxed as well.
    if (["script", "iframe", "object", "embed", "base", "noscript"].includes(el.tagName) || (el.tagName === "meta" && attr(el, "http-equiv"))) {
      drop(el);
      continue;
    }
    el.attrs = el.attrs.filter((a) => !/^on/i.test(a.name));
    if (el.tagName === "link") {
      const href = attr(el, "href");
      const target = href && joinPath(dirname(path), decodePath(href.split(/[#?]/)[0]));
      if (/stylesheet/i.test(attr(el, "rel") ?? "") && target && book.has(target)) {
        const style = make("style", [], css(target, decodeUtf8(book.files.get(target)!)));
        el.parentNode!.childNodes.splice(el.parentNode!.childNodes.indexOf(el), 1, style);
        style.parentNode = el.parentNode;
      } else drop(el);
      continue;
    }
    if (el.tagName === "style")
      for (const t of el.childNodes) if (t.nodeName === "#text") (t as { value: string }).value = css(path, (t as { value: string }).value);
    const style = attr(el, "style");
    if (style) setAttr(el, "style", css(path, style));
    for (const name of ["src", "poster", "href", "xlink:href"]) {
      const v = attr(el, name);
      if (v === undefined) continue;
      if (el.tagName === "a") {
        // Links look like links but go nowhere: following one would leave the page being laid out.
        el.attrs = el.attrs.filter((a) => a.name !== "href");
        setAttr(el, "data-link", "");
      } else setAttr(el, name, dataUrl(path, v) ?? "");
    }
    if (el.tagName === "img" || el.tagName === "source") el.attrs = el.attrs.filter((a) => a.name !== "srcset");
  }
  if (head) head.childNodes.unshift(Object.assign(make("meta", [{ name: "charset", value: "utf-8" }]), { parentNode: head }));
  // Hyphenation follows the language, as on a reader.
  const lang = html && (attr(html, "lang") || attr(html, "xml:lang"));
  if (html && lang) setAttr(html, "lang", lang);
  return serialize(doc).replace(/^(<!DOCTYPE[^>]*>)?/i, "<!DOCTYPE html>\n");
}

// ------------------------------------------------------------ parse5 helpers

function all(root: Node, tag?: string): Element[] {
  const out: Element[] = [];
  const walk = (n: Node) => {
    if ("tagName" in n && (!tag || n.tagName === tag)) out.push(n);
    const kids = "content" in n && n.nodeName === "template" ? [] : "childNodes" in n ? n.childNodes : [];
    for (const c of [...kids]) walk(c as Node);
  };
  walk(root);
  return out;
}

function text(n: Node): string {
  let s = "";
  const walk = (x: Node) => {
    if (x.nodeName === "#text") s += (x as { value: string }).value;
    if ("childNodes" in x) for (const c of x.childNodes) walk(c as Node);
  };
  walk(n);
  return s.replace(/\s+/g, " ").trim();
}

const attr = (el: Element, name: string) => el.attrs.find((a) => a.name === name || (a.prefix && `${a.prefix}:${a.name}` === name))?.value;

function setAttr(el: Element, name: string, value: string) {
  const a = el.attrs.find((x) => x.name === name || (x.prefix && `${x.prefix}:${x.name}` === name));
  if (a) a.value = value;
  else el.attrs.push({ name, value });
}

function drop(el: Element) {
  const kids = el.parentNode?.childNodes;
  if (kids) kids.splice(kids.indexOf(el), 1);
}

function make(tagName: string, attrs: { name: string; value: string }[], content?: string): Element {
  const el = { nodeName: tagName, tagName, attrs, namespaceURI: "http://www.w3.org/1999/xhtml", childNodes: [], parentNode: null } as unknown as Element;
  if (content !== undefined) el.childNodes.push({ nodeName: "#text", value: content, parentNode: el } as never);
  return el;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
