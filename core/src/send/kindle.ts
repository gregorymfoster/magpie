// Send to Kindle by email. Magpie opens a new message in the person's own
// Mail with the books attached and the Kindle address filled in (Host.mail).
// They press Send; nothing leaves the Mac without them.
//
// What goes is a Kindle-safe copy of the clean book (toKindle): Amazon turns
// the EPUB into its own format, and its converter rejects or mangles a few
// things readers elsewhere shrug off.

import { Book, decodeUtf8, dirname, joinPath, decodePath, byLocal } from "../epub.ts";
import { DOMParser } from "@xmldom/xmldom";
import { contentDocs } from "../fixers/xhtml.ts";
import { parseCss, rules, writeCss, type CssNode } from "../fixers/css.ts";

/** Amazon's limit for one Send to Kindle email, attachments included. */
export const KINDLE_LIMIT = 50 * 1024 * 1024;

/**
 * Kindle-safe: no obfuscated or broken embedded fonts (Amazon's converter
 * fails on them; the Kindle's own fonts are the better read anyway), no
 * scripts, and no CSS that positions or sizes things to the window
 * (fixed and absolute positioning, vw and vh units), which comes out as
 * overlapping or vanishing text.
 */
export function toKindle(epub: Uint8Array): Uint8Array {
  const book = Book.load(epub);
  if (!book.opfPath) return epub;
  const opf = book.opf();
  const drop = new Set<string>();

  // Obfuscated fonts: listed in encryption.xml. Only fonts are ever let through as obfuscated (Book.isLocked).
  const enc = book.files.get("META-INF/encryption.xml");
  if (enc) {
    const doc = new DOMParser().parseFromString(decodeUtf8(enc), "application/xml") as unknown as Document;
    for (const ref of byLocal(doc, "CipherReference")) drop.add(decodePath(ref.getAttribute("URI") ?? ""));
    book.files.delete("META-INF/encryption.xml");
  }
  // Fonts that aren't fonts: a converter that chokes on one rejects the whole book.
  for (const item of opf.items()) {
    const path = opf.itemPath(item);
    if (/font|opentype|truetype|sfnt|woff/.test(item.getAttribute("media-type") ?? "") && book.has(path) && !isFont(book.files.get(path)!)) drop.add(path);
  }
  for (const path of drop) book.files.delete(path);
  for (const item of opf.items()) if (drop.has(opf.itemPath(item))) item.parentNode!.removeChild(item);
  opf.save();

  const fixSheet = (src: string, from: string): string | null => {
    let nodes: CssNode[];
    try {
      nodes = parseCss(src);
    } catch {
      return null;
    }
    let changed = false;
    const keep = (list: CssNode[]): CssNode[] =>
      list.filter((n) => {
        if (n.kind === "block") n.body = keep(n.body);
        if (n.kind === "at" && /^@font-face/i.test(n.prelude) && n.decls) {
          const src = n.decls.find((d) => d.prop === "src")?.value ?? "";
          const urls = [...src.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => joinPath(dirname(from), decodePath(m[1])));
          if (urls.length && urls.every((u) => drop.has(u) || !book.has(u))) return !(changed = true);
        }
        return true;
      });
    nodes = keep(nodes);
    for (const r of rules(nodes)) {
      const kept = r.decls.filter((d) => !(d.prop === "position" && /fixed|absolute/i.test(d.value)) && !/\d(vw|vh|vmin|vmax)\b/i.test(d.value));
      if (kept.length !== r.decls.length) {
        r.decls = kept;
        changed = true;
      }
    }
    return changed ? writeCss(nodes) + "\n" : null;
  };
  for (const item of opf.items().filter((i) => i.getAttribute("media-type") === "text/css")) {
    const path = opf.itemPath(item);
    if (!book.has(path)) continue;
    const out = fixSheet(decodeUtf8(book.files.get(path)!), path);
    if (out !== null) book.setText(path, out);
  }
  for (const path of contentDocs(book)) {
    const s = decodeUtf8(book.files.get(path)!);
    let out = s.replace(/<script\b[\s\S]*?<\/script>|<script\b[^>]*\/>/gi, "");
    out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, open, css, close) => {
      const fixed = fixSheet(css, path);
      return fixed === null ? m : `${open}\n${fixed}${close}`;
    });
    if (out !== s) book.setText(path, out);
  }
  return book.save();
}

/** TrueType, OpenType, WOFF or WOFF2, by its first four bytes. */
function isFont(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  return tag === "\0\x01\0\0" || tag === "OTTO" || tag === "true" || tag === "wOFF" || tag === "wOF2" || tag === "ttcf";
}
