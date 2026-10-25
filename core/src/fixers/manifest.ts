// The manifest and spine: the book's list of files and its reading order.
// Fixes items that point at missing files, files the manifest forgot, wrong
// media types, file names with spaces, and spine entries that point nowhere
// (which silently drops a chapter on some devices and fails Send to Kindle on others).

import { MEDIA_TYPES, extOf, decodePath, dirname, joinPath, relativeHref, type Book, type OpfDoc } from "../epub.ts";
import type { Change, Fixer } from "./types.ts";

const FONT_TYPES = new Set([
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  "font/sfnt",
  "application/font-sfnt",
  "application/vnd.ms-opentype",
  "application/x-font-ttf",
  "application/x-font-truetype",
  "application/x-font-opentype",
  "application/font-woff",
]);
const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX\/.*|iTunesMetadata\.plist|iTunesArtwork)$/;
const TEXTY = /^(x?html?|opf|ncx|css|svg|xml)$/;
const SAFE = /^[A-Za-z0-9._\-/]+$/;

export const manifest: Fixer = {
  id: "manifest",
  title: "Repair the file list and reading order",
  run(book: Book): Change[] {
    if (!book.opfPath) return [];
    const changes: Change[] = [];
    const say = (message: string, path?: string) => changes.push({ fixer: "manifest", message, path });

    for (const p of [...book.files.keys()]) {
      if (JUNK.test(p)) {
        book.files.delete(p);
        say(`Removed ${p}, a stray system file.`, p);
      }
    }
    renameUnsafe(book, say);

    const opf = book.opf();
    const zipPaths = [...book.files.keys()];
    const lower = new Map(zipPaths.map((p) => [p.toLowerCase(), p]));
    const removed = new Set<string>();

    for (const item of opf.items()) {
      const href = item.getAttribute("href") ?? "";
      const path = opf.itemPath(item);
      if (book.has(path)) continue;
      const alt = lower.get(path.toLowerCase());
      if (alt) {
        item.setAttribute("href", relativeHref(opf.path, alt));
        say(`Fixed the capitalisation of ${href} in the file list.`, alt);
        continue;
      }
      removed.add(item.getAttribute("id") ?? "");
      item.parentNode?.removeChild(item);
      say(`Removed ${href} from the file list because it isn't in the book.`, path);
    }

    const listed = new Set(opf.items().map((i) => opf.itemPath(i)));
    for (const p of [...book.files.keys()].sort(natural)) {
      if (p === "mimetype" || p.startsWith("META-INF/") || p === opf.path || listed.has(p)) continue;
      const mt = MEDIA_TYPES[extOf(p)] ?? "application/octet-stream";
      const el = opf.doc.createElementNS(opf.pkg.namespaceURI, "item");
      el.setAttribute(
        "id",
        opf.uniqueId(
          p
            .split("/")
            .pop()!
            .replace(/\.[^.]+$/, ""),
        ),
      );
      el.setAttribute("href", relativeHref(opf.path, p));
      el.setAttribute("media-type", mt);
      opf.section("manifest").appendChild(el);
      say(`Added ${p} to the file list; it was in the book but not declared.`, p);
    }

    for (const item of opf.items()) {
      const ext = extOf(opf.itemPath(item));
      const want = MEDIA_TYPES[ext];
      const have = item.getAttribute("media-type") ?? "";
      if (!want || have === want) continue;
      if (FONT_TYPES.has(want) && FONT_TYPES.has(have)) continue;
      item.setAttribute("media-type", want);
      say(`Set the type of ${item.getAttribute("href")} to ${want} (was "${have || "missing"}").`);
    }

    fixSpine(opf, removed, say);
    opf.save();
    return changes;
  },
};

function fixSpine(opf: OpfDoc, removedIds: Set<string>, say: (m: string) => void) {
  const spine = opf.section("spine");
  const ids = new Set(opf.items().map((i) => i.getAttribute("id")));
  const refs = opf.itemrefs();
  let firstBad = -1;
  let bad = 0;
  refs.forEach((ref, i) => {
    const idref = ref.getAttribute("idref") ?? "";
    if (ids.has(idref)) return;
    if (firstBad < 0) firstBad = i;
    bad++;
    spine.removeChild(ref);
    if (!removedIds.has(idref)) say(`Removed a reading-order entry ("${idref}") that pointed at nothing.`);
  });

  // A spine entry that pointed nowhere usually means a chapter fell out of the
  // reading order. Put back content documents that nothing in the spine uses.
  if (bad) {
    const inSpine = new Set(opf.itemrefs().map((r) => r.getAttribute("idref")));
    const orphans = opf
      .items()
      .filter((i) => i.getAttribute("media-type") === "application/xhtml+xml")
      .filter((i) => !inSpine.has(i.getAttribute("id")) && !/\bnav\b/.test(i.getAttribute("properties") ?? ""))
      .sort((a, b) => natural(a.getAttribute("href") ?? "", b.getAttribute("href") ?? ""));
    const before = opf.itemrefs()[firstBad] ?? null;
    for (const o of orphans) {
      const ref = opf.doc.createElementNS(spine.namespaceURI, "itemref");
      ref.setAttribute("idref", o.getAttribute("id")!);
      // Where the broken entry was is the best guess for where the chapter belongs.
      spine.insertBefore(ref, before);
      say(`Put ${o.getAttribute("href")} back into the reading order.`);
    }
  }

  const toc = spine.getAttribute("toc");
  const ncx = opf.items().find((i) => i.getAttribute("media-type") === "application/x-dtbncx+xml");
  if (toc && !ids.has(toc)) {
    if (ncx) spine.setAttribute("toc", ncx.getAttribute("id")!);
    else spine.removeAttribute("toc");
    say("Fixed the spine's link to the table of contents.");
  } else if (!toc && ncx && !opf.epub3) {
    spine.setAttribute("toc", ncx.getAttribute("id")!);
    say("Linked the spine to the table of contents (toc.ncx).");
  }
}

/** Rename files with spaces or other unsafe characters and update every reference. */
function renameUnsafe(book: Book, say: (m: string, p?: string) => void) {
  const renames = new Map<string, string>();
  for (const p of book.files.keys()) {
    if (p === "mimetype" || p.startsWith("META-INF/") || SAFE.test(p)) continue;
    let safe = p
      .split("/")
      .map((seg) => seg.normalize("NFKD").replace(/[^\w.-]+/g, "_"))
      .join("/");
    for (let n = 2; book.has(safe) || [...renames.values()].includes(safe); n++) safe = safe.replace(/(\.[^.]+)?$/, `-${n}$1`);
    renames.set(p, safe);
  }
  if (!renames.size) return;
  for (const [from, to] of renames) {
    book.files.set(to, book.files.get(from)!);
    book.files.delete(from);
    if (book.opfPath === from) book.opfPath = to;
    say(`Renamed "${from}" to ${to} because spaces and special characters in file names break some readers and converters.`, to);
  }
  for (const p of [...book.files.keys()]) {
    if (!TEXTY.test(extOf(p)) && p !== "META-INF/container.xml") continue;
    const before = book.text(p);
    const after = before.replace(
      /((?:href|src|full-path|xlink:href)\s*=\s*)(["'])(.*?)\2|(url\(\s*)(["']?)([^"')]+)\5(\s*\))/g,
      (m, a1, q1, v1, u1, q2, v2, u3) => {
        const value: string = v1 ?? v2;
        const [ref, frag] = value.split("#");
        if (!ref || /^[a-z]+:/i.test(ref)) return m;
        const base = p.startsWith("META-INF/") ? "" : dirname(p);
        const target = joinPath(base, decodePath(ref));
        const to = renames.get(target);
        if (!to) return m;
        const href = (p.startsWith("META-INF/") ? to : relativeHref(p, to)) + (frag !== undefined ? "#" + frag : "");
        return v1 !== undefined ? `${a1}${q1}${href}${q1}` : `${u1}${q2}${href}${q2}${u3}`;
      },
    );
    if (after !== before) book.setText(p, after);
  }
}

export function natural(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
