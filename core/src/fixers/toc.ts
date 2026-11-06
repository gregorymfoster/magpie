// Tables of contents: toc.ncx (EPUB 2, and what Kindle still reads) and the
// EPUB 3 nav document. Drops entries that point at files the book doesn't
// have, matches the NCX's book id to the package, and builds a nav document
// from the NCX when an EPUB 3 file is missing one.

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { byLocal, decodeUtf8, dirname, joinPath, decodePath, relativeHref, textOf, type Book, type OpfDoc } from "../epub.ts";
import type { Change, Fixer } from "./types.ts";

export const toc: Fixer = {
  id: "toc",
  title: "Repair the table of contents",
  run(book: Book): Change[] {
    if (!book.opfPath) return [];
    const opf = book.opf();
    const changes: Change[] = [];
    const say = (message: string, path?: string) => changes.push({ fixer: "toc", message, path });
    const exists = (from: string, href: string) => book.has(joinPath(dirname(from), decodePath(href.split("#")[0])));

    const ncxItem = opf.items().find((i) => i.getAttribute("media-type") === "application/x-dtbncx+xml");
    const ncxPath = ncxItem && opf.itemPath(ncxItem);
    const ncx = ncxPath && book.has(ncxPath) ? readNcx(decodeUtf8(book.files.get(ncxPath)!)) : null;
    if (ncxPath && book.has(ncxPath) && !ncx) {
      // So damaged it won't parse: made again from the reading order, the way a missing nav document is.
      book.setText(ncxPath, buildNcx(readingOrder(book, opf), ncxPath, uniqueIdentifier(opf) ?? "", textOf(opf.dc("title")[0])));
      say("Rebuilt the table of contents (toc.ncx), which was too damaged to read, from the book's chapters.", ncxPath);
    } else if (ncxPath && ncx) {
      const doc = ncx;
      let dropped = 0;
      for (const np of byLocal(doc, "navPoint")) {
        const src =
          byLocal(np, "content")
            .find((c) => c.parentNode === np)
            ?.getAttribute("src") ?? "";
        if (exists(ncxPath, src)) continue;
        // keep any children by lifting them into the parent
        for (const child of byLocal(np, "navPoint").filter((c) => c.parentNode === np)) np.parentNode!.insertBefore(child, np);
        np.parentNode!.removeChild(np);
        dropped++;
      }
      byLocal(doc, "navPoint").forEach((np, i) => np.setAttribute("playOrder", String(i + 1)));
      if (dropped) say(`Removed ${dropped} table-of-contents entr${dropped > 1 ? "ies" : "y"} that pointed at missing pages.`, ncxPath);

      const uid = uniqueIdentifier(opf);
      const meta = byLocal(doc, "meta").find((m) => m.getAttribute("name") === "dtb:uid");
      if (uid && meta && meta.getAttribute("content") !== uid) {
        meta.setAttribute("content", uid);
        say("Matched the table of contents' book id to the package's id.", ncxPath);
        dropped++;
      }
      if (dropped) book.setText(ncxPath, new XMLSerializer().serializeToString(doc as never));
    }

    if (opf.epub3) {
      const navItem = opf.items().find((i) => /\bnav\b/.test(i.getAttribute("properties") ?? ""));
      const navPath = navItem && opf.itemPath(navItem);
      if (navPath && book.has(navPath)) {
        const html = book.text(navPath);
        let n = 0;
        const fixed = html.replace(/<li\b[^>]*>\s*<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>[\s\S]*?<\/a>\s*<\/li>/g, (m, href) => {
          if (/^[a-z]+:/i.test(href) || exists(navPath, href)) return m;
          n++;
          return "";
        });
        if (n) {
          book.setText(navPath, fixed);
          say(`Removed ${n} contents link${n > 1 ? "s" : ""} that pointed at missing pages.`, navPath);
        }
      } else {
        const path = joinPath(dirname(opf.path), "nav.xhtml");
        book.setText(path, buildNav(book, opf, path, ncxPath));
        const item = opf.doc.createElementNS(opf.pkg.namespaceURI, "item");
        item.setAttribute("id", opf.uniqueId("nav"));
        item.setAttribute("href", relativeHref(opf.path, path));
        item.setAttribute("media-type", "application/xhtml+xml");
        item.setAttribute("properties", "nav");
        opf.section("manifest").appendChild(item);
        opf.save();
        say("Built the EPUB 3 contents page the book was missing.", path);
      }
    }
    return changes;
  },
};

function uniqueIdentifier(opf: OpfDoc): string | undefined {
  const ref = opf.pkg.getAttribute("unique-identifier");
  return textOf(opf.dc("identifier").find((i) => i.getAttribute("id") === ref)) || undefined;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A nav document from the NCX if there is one, otherwise from the reading order. */
function buildNav(book: Book, opf: OpfDoc, navPath: string, ncxPath?: string): string {
  const entries: { label: string; path: string; frag?: string }[] = [];
  const doc = ncxPath && book.has(ncxPath) ? readNcx(book.text(ncxPath)) : null;
  if (ncxPath && doc) {
    for (const np of byLocal(doc, "navPoint")) {
      const src = byLocal(np, "content")[0]?.getAttribute("src") ?? "";
      const [file, frag] = src.split("#");
      entries.push({ label: textOf(byLocal(np, "text")[0]), path: joinPath(dirname(ncxPath), decodePath(file)), frag });
    }
  }
  if (!entries.length) entries.push(...readingOrder(book, opf));
  const lang = textOf(opf.dc("language")[0]) || "en";
  const lis = entries.map((e) => `<li><a href="${esc(relativeHref(navPath, e.path) + (e.frag ? "#" + e.frag : ""))}">${esc(e.label)}</a></li>`).join("\n");
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}">\n` +
    `<head><title>Contents</title></head>\n<body>\n<nav epub:type="toc" id="toc"><h1>Contents</h1>\n<ol>\n${lis}\n</ol></nav>\n</body>\n</html>\n`
  );
}

/** Each page in reading order, labelled by its first heading, or its title when it has none. */
function readingOrder(book: Book, opf: OpfDoc): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = [];
  for (const ref of opf.itemrefs()) {
    const it = opf.itemById(ref.getAttribute("idref") ?? "");
    if (!it) continue;
    const path = opf.itemPath(it);
    if (!book.has(path)) continue;
    const text = book.text(path);
    const m = text.match(/<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/i) ?? text.match(/<(title)[^>]*>([\s\S]*?)<\/\1>/i);
    out.push({ label: (m?.[2] ?? path).replace(/<[^>]+>/g, "").trim(), path });
  }
  return out;
}

/** An NCX document, or null when it's too broken to parse or isn't one. */
function readNcx(text: string): Document | null {
  try {
    const doc = new DOMParser({ onError: () => {} }).parseFromString(text, "application/xml") as unknown as Document;
    return doc.documentElement?.localName === "ncx" ? doc : null;
  } catch {
    return null;
  }
}

function buildNcx(entries: { label: string; path: string }[], ncxPath: string, uid: string, title: string): string {
  const points = entries
    .map(
      (e, i) =>
        `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(e.label)}</text></navLabel><content src="${esc(relativeHref(ncxPath, e.path))}"/></navPoint>`,
    )
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n` +
    `<head><meta name="dtb:uid" content="${esc(uid)}"/></head>\n<docTitle><text>${esc(title)}</text></docTitle>\n<navMap>\n${points}\n</navMap>\n</ncx>\n`
  );
}
