// KEPUB: the EPUB flavour Kobo's own reader uses for page numbers, reading
// stats and its better typesetting. The difference is markup only: every
// sentence wrapped in <span class="koboSpan" id="kobo.P.S">, and the body
// wrapped in book-columns / book-inner divs. The Library keeps plain EPUB;
// this runs when a book is sent to a Kobo.

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { Book, decodeUtf8 } from "../epub.ts";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SKIP = new Set(["script", "style", "svg", "math", "pre", "code", "ruby", "rt", "rp"]);
// A sentence ends at . ! ? or … plus any closing quotes or brackets, then whitespace.
const SENTENCE = /(?<=[.!?…]["'”’)\]]*)\s+/u;

export function toKepub(epub: Uint8Array): Uint8Array {
  const book = Book.load(epub);
  if (!book.opfPath) return epub;
  const opf = book.opf();
  for (const ref of opf.itemrefs()) {
    const item = opf.itemById(ref.getAttribute("idref") ?? "");
    if (!item || !/xhtml|html/.test(item.getAttribute("media-type") ?? "")) continue;
    const path = opf.itemPath(item);
    if (!book.has(path)) continue;
    const src = decodeUtf8(book.files.get(path)!);
    if (src.includes("koboSpan")) continue;
    const out = kepubPage(src);
    if (out) book.setText(path, out);
  }
  return book.save();
}

/** One XHTML page with spans added, or null when it can't be parsed (it's left as is). */
export function kepubPage(xhtml: string): string | null {
  let failed = false;
  const doc = new DOMParser({ onError: (level) => void (level !== "warning" && (failed = true)) }).parseFromString(
    xhtml,
    "application/xhtml+xml",
  ) as unknown as Document;
  if (failed) return null;
  const body = doc.getElementsByTagName("body")[0];
  if (!body) return null;

  let para = 0;
  const walk = (el: Element) => {
    let sentence = 0;
    let counted = false;
    for (const node of [...(el.childNodes as unknown as Node[])]) {
      if (node.nodeType === 1) {
        const child = node as Element;
        if (!SKIP.has(child.localName)) walk(child);
        continue;
      }
      if (node.nodeType !== 3 || !node.nodeValue?.trim()) continue;
      // Each element with text of its own is one Kobo "paragraph".
      if (!counted) {
        para++;
        counted = true;
      }
      const frag = doc.createDocumentFragment();
      const pieces = splitSentences(node.nodeValue);
      for (const p of pieces) {
        if (!p.trim()) {
          frag.appendChild(doc.createTextNode(p));
          continue;
        }
        const span = doc.createElementNS(XHTML_NS, "span");
        span.setAttribute("class", "koboSpan");
        span.setAttribute("id", `kobo.${para}.${++sentence}`);
        span.appendChild(doc.createTextNode(p));
        frag.appendChild(span);
      }
      el.replaceChild(frag, node);
    }
  };
  walk(body);

  const columns = doc.createElementNS(XHTML_NS, "div");
  columns.setAttribute("id", "book-columns");
  const inner = doc.createElementNS(XHTML_NS, "div");
  inner.setAttribute("id", "book-inner");
  columns.appendChild(inner);
  while (body.firstChild) inner.appendChild(body.firstChild);
  body.appendChild(columns);
  return new XMLSerializer().serializeToString(doc as never);
}

/** "One. Two!" -> ["One.", " ", "Two!"]: sentences and the whitespace between them, nothing lost. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  for (;;) {
    const m = SENTENCE.exec(rest);
    if (!m) break;
    out.push(rest.slice(0, m.index), m[0]);
    rest = rest.slice(m.index + m[0].length);
  }
  out.push(rest);
  return out.filter((s) => s !== "");
}
