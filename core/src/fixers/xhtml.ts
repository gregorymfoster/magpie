// Content documents that aren't well-formed XHTML: unclosed tags, HTML entities
// like &nbsp;, bare ampersands, tag soup, Windows-1252 bytes, duplicate ids.
// Kindle's converter fails on many of these with "we couldn't process your
// document". We re-parse with a browser-grade HTML parser (parse5) and write
// strict XHTML back out, which is what Calibre's convert-again trick does too,
// minus the install.

import { parse } from "parse5";
import { SaxesParser } from "saxes";
import { extOf, isValidUtf8, decodeUtf8, type Book } from "../epub.ts";
import type { Change, Fixer } from "./types.ts";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";
const MATHML_NS = "http://www.w3.org/1998/Math/MathML";
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
// HTML parsing lets <b> or <span> wrap whole paragraphs when a tag is left open.
// That parses, but isn't valid XHTML, so we drop the inline wrapper and keep its contents.
const INLINE = new Set(["a", "abbr", "b", "big", "cite", "code", "em", "font", "i", "q", "s", "small", "span", "strike", "strong", "sub", "sup", "tt", "u"]);
const BLOCK = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);
const DOCTYPE2 = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';

export function contentDocs(book: Book): string[] {
  if (book.opfPath) {
    try {
      const docs = book
        .opf()
        .items()
        .filter((i) => /xhtml|html/.test(i.getAttribute("media-type") ?? "") || /^x?html?$/.test(extOf(i.getAttribute("href") ?? "")))
        .map((i) => book.opf().itemPath(i))
        .filter((p) => book.has(p));
      if (docs.length) return docs;
    } catch {
      /* fall through to scanning the zip */
    }
  }
  return [...book.files.keys()].filter((p) => /^x?html?$/.test(extOf(p)));
}

/** saxes errors for a document, or [] if it is well-formed XML. */
export function wellFormednessErrors(s: string): string[] {
  const errors: string[] = [];
  const p = new SaxesParser({ xmlns: true });
  p.on("error", (e) => errors.push(e.message));
  try {
    p.write(s).close();
  } catch (e) {
    errors.push(String(e));
  }
  return errors;
}

function duplicateIds(s: string): boolean {
  const seen = new Set<string>();
  for (const m of s.matchAll(/\sid\s*=\s*["']([^"']*)["']/g)) {
    if (seen.has(m[1])) return true;
    seen.add(m[1]);
  }
  return false;
}

export const xhtml: Fixer = {
  id: "xhtml",
  title: "Repair broken XHTML",
  run(book: Book): Change[] {
    const changes: Change[] = [];
    let epub3 = false;
    try {
      epub3 = book.opfPath ? book.opf().epub3 : false;
    } catch {
      /* unparseable OPF: assume EPUB 2 */
    }
    for (const path of contentDocs(book)) {
      const bytes = book.files.get(path)!;
      const reencode = !isValidUtf8(bytes);
      let s = decodeUtf8(bytes);
      const errors = wellFormednessErrors(s);
      const dupes = duplicateIds(s);
      if (!reencode && !errors.length && !dupes) continue;
      if (reencode) {
        changes.push({ fixer: "xhtml", path, message: `Converted ${path} from Windows-1252 to UTF-8 so curly quotes and accents survive.` });
      }
      s = s.replace(/^(\s*<\?xml[^>]*encoding=["'])[^"']*/, "$1utf-8");
      if (errors.length || dupes) {
        const { out, renamedIds } = toXhtml(s, epub3);
        s = out;
        if (errors.length) {
          changes.push({
            fixer: "xhtml",
            path,
            message: `Rewrote ${path} as well-formed XHTML (it had ${describe(errors[0])}).`,
          });
        }
        if (renamedIds) changes.push({ fixer: "xhtml", path, message: `Renamed ${renamedIds} duplicate id${renamedIds > 1 ? "s" : ""} in ${path}.` });
      }
      book.setText(path, s);
    }
    return changes;
  },
};

function describe(err: string): string {
  if (/undefined entity/.test(err)) return "an HTML-only entity such as &nbsp;";
  if (/unclosed tag|unexpected close tag|mismatched/i.test(err)) return "unclosed or mismatched tags";
  if (/attribute.*(quote|value)|unquoted/i.test(err)) return "unquoted attributes";
  if (/&|entity|reference/i.test(err)) return "a bare & that should be &amp;";
  return "markup errors";
}

// ---- parse5 tree -> XHTML string

type P5Node = {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  attrs?: { name: string; value: string; prefix?: string }[];
  childNodes?: P5Node[];
  value?: string;
  data?: string;
  content?: P5Node;
};

const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => escText(s).replace(/"/g, "&quot;");
const XML_NAME = /^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/;

export function toXhtml(html: string, epub3: boolean): { out: string; renamedIds: number } {
  const doc = parse(html.replace(/^\s*<\?xml[^>]*\?>/, "")) as unknown as P5Node;
  const seenIds = new Set<string>();
  let renamedIds = 0;
  const usesEpubNs = /\sepub:/.test(html);

  const ser = (n: P5Node, parentNs: string): string => {
    if (n.nodeName === "#text") return escText(n.value ?? "");
    if (n.nodeName === "#comment") return `<!--${(n.data ?? "").replace(/--/g, "- -").replace(/-$/, "- ")}-->`;
    if (n.nodeName.startsWith("#") || !n.tagName) return (n.childNodes ?? []).map((c) => ser(c, parentNs)).join("");
    const ns = n.namespaceURI ?? XHTML_NS;
    const tag = n.tagName;
    const kidsOf = n.childNodes ?? [];
    const blank = kidsOf.every((c) => c.nodeName === "#text" && !(c.value ?? "").trim());
    // ...and an open tag left at the end of a page comes back as an empty <b> after the last block.
    if (INLINE.has(tag) && tag !== "a" && (blank || kidsOf.some((c) => c.tagName && BLOCK.has(c.tagName)))) {
      return (n.childNodes ?? []).map((c) => ser(c, parentNs)).join("");
    }
    const attrs: string[] = [];
    const names = new Set<string>();
    if (tag === "html") {
      attrs.push(`xmlns="${XHTML_NS}"`);
      if (usesEpubNs || epub3) attrs.push('xmlns:epub="http://www.idpf.org/2007/ops"');
      names.add("xmlns").add("xmlns:epub");
    } else if (ns !== parentNs && (ns === SVG_NS || ns === MATHML_NS)) {
      attrs.push(`xmlns="${ns}"`);
      names.add("xmlns");
      if (ns === SVG_NS) {
        attrs.push('xmlns:xlink="http://www.w3.org/1999/xlink"');
        names.add("xmlns:xlink");
      }
    }
    for (const a of n.attrs ?? []) {
      const name = a.prefix ? `${a.prefix}:${a.name}` : a.name;
      if (names.has(name) || !XML_NAME.test(name) || name.startsWith("xmlns")) continue;
      let value = a.value;
      if (name === "id") {
        if (seenIds.has(value)) {
          let k = 2;
          while (seenIds.has(`${value}-${k}`)) k++;
          value = `${value}-${k}`;
          renamedIds++;
        }
        seenIds.add(value);
      }
      names.add(name);
      attrs.push(`${name}="${escAttr(value)}"`);
    }
    const open = `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}`;
    const kids = n.content ? [n.content] : (n.childNodes ?? []);
    if (VOID.has(tag) && ns === XHTML_NS) return `${open}/>`;
    if (!kids.length && ns !== XHTML_NS) return `${open}/>`;
    return `${open}>${kids.map((c) => ser(c, ns)).join("")}</${tag}>`;
  };

  const html5 = (doc.childNodes ?? []).find((c) => c.tagName === "html")!;
  const body = ser(html5, "");
  return {
    out: `<?xml version="1.0" encoding="utf-8"?>\n${epub3 ? "<!DOCTYPE html>" : DOCTYPE2}\n${body}\n`,
    renamedIds,
  };
}
