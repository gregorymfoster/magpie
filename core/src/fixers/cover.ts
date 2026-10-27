// The cover declaration. A book can ship a perfectly good cover image and
// still show a grey placeholder on Kindle, because nothing in the package says
// "this image is the cover". We find the image and declare it both ways:
// <meta name="cover"> (EPUB 2, and what Kindle still reads) and the
// cover-image property (EPUB 3).

import { byLocal, decodeUtf8, dirname, joinPath, decodePath, type Book, type OpfDoc } from "../epub.ts";
import type { Change, Fixer } from "./types.ts";

const isImage = (i: Element) => /^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(i.getAttribute("media-type") ?? "");

export const cover: Fixer = {
  id: "cover",
  title: "Declare the cover so devices show it",
  run(book: Book): Change[] {
    if (!book.opfPath) return [];
    const opf = book.opf();
    const changes: Change[] = [];
    const say = (message: string, source?: string) => changes.push({ fixer: "cover", message, source });

    const meta = opf.metas().find((m) => m.getAttribute("name") === "cover");
    const metaItem = meta ? opf.itemById(meta.getAttribute("content") ?? "") : undefined;
    const propItem = opf.items().find((i) => /\bcover-image\b/.test(i.getAttribute("properties") ?? ""));
    const metaOk = metaItem && isImage(metaItem);
    if (metaOk && (!opf.epub3 || propItem === metaItem)) return [];
    if (!opf.epub3 && metaOk) return [];

    const found =
      (propItem && isImage(propItem) && { item: propItem, why: "the EPUB 3 cover-image property" }) ||
      (metaOk && { item: metaItem!, why: "the cover meta tag" }) ||
      findCover(book, opf, meta);
    // No image at all: fix() makes one from the title and author once the details are settled.
    if (!found) return changes;
    const id = found.item.getAttribute("id")!;
    if (!metaOk) {
      if (meta) meta.setAttribute("content", id);
      else opf.addMeta({ name: "cover", content: id });
      say(`Declared ${found.item.getAttribute("href")} as the cover, found via ${found.why}. Kindle reads this tag.`, found.why);
    }
    if (opf.epub3 && propItem !== found.item) {
      if (propItem) propItem.setAttribute("properties", (propItem.getAttribute("properties") ?? "").replace(/\bcover-image\b/, "").trim());
      if (propItem && !propItem.getAttribute("properties")) propItem.removeAttribute("properties");
      const props = (found.item.getAttribute("properties") ?? "").split(/\s+/).filter(Boolean);
      found.item.setAttribute("properties", [...props, "cover-image"].join(" "));
      if (metaOk) say(`Marked ${found.item.getAttribute("href")} with the EPUB 3 cover-image property.`, found.why);
    }
    // Drop a meta tag that pointed at nothing usable and wasn't reused above.
    opf.save();
    return changes;
  },
};

function findCover(book: Book, opf: OpfDoc, meta: Element | undefined): { item: Element; why: string } | undefined {
  const images = opf.items().filter(isImage);
  if (!images.length) return;
  // 1. a cover meta whose content is an href instead of an id (a common authoring-tool bug)
  const content = meta?.getAttribute("content");
  if (content) {
    const path = book.resolve(content);
    const hit = images.find((i) => opf.itemPath(i) === path || i.getAttribute("href") === content);
    if (hit) return { item: hit, why: "a cover tag that used the file name instead of its id" };
  }
  // 2. the guide's cover page, or the first page in reading order, if it shows a single image
  const pages: string[] = [];
  for (const ref of byLocal(opf.pkg, "reference")) if (/cover/i.test(ref.getAttribute("type") ?? "")) pages.push(book.resolve(ref.getAttribute("href") ?? ""));
  const first = opf.itemById(opf.itemrefs()[0]?.getAttribute("idref") ?? "");
  if (first) pages.push(opf.itemPath(first));
  for (const page of pages) {
    if (!book.has(page)) continue;
    const html = decodeUtf8(book.files.get(page)!);
    const srcs = [...html.matchAll(/<(?:img[^>]+src|image[^>]+(?:xlink:)?href)\s*=\s*["']([^"']+)["']/gi)].map((m) =>
      joinPath(dirname(page), decodePath(m[1])),
    );
    if (srcs.length === 1) {
      const hit = images.find((i) => opf.itemPath(i) === srcs[0]);
      if (hit) return { item: hit, why: page === pages[pages.length - 1] && first ? "the image on the book's first page" : "the guide's cover page" };
    }
  }
  // 3. an image whose id or file name says cover
  const named = images.find((i) => /cover/i.test(i.getAttribute("id") ?? "")) ?? images.find((i) => /cover/i.test(i.getAttribute("href") ?? ""));
  if (named) return { item: named, why: 'an image named "cover"' };
  return;
}

/** Where a cover Magpie puts in came from, for the change message. */
export type CoverFrom = "you" | "calibre" | "openlibrary" | "magpie";

const FROM: Record<CoverFrom, string> = {
  you: "Used the cover you chose",
  calibre: "Put Calibre's cover into the book",
  openlibrary: "Put the cover from Open Library into the book",
  magpie: "Made a cover from the title and author",
};

/**
 * Put a cover image into the book and declare it as the cover, both ways.
 * The book's old cover image, if any, stays in the book (a cover page may
 * still show it) but is no longer declared.
 */
export function putCover(book: Book, image: { bytes: Uint8Array; mediaType: string }, from: CoverFrom): Change[] {
  if (!book.opfPath) return [];
  const opf = book.opf();
  const ext = image.mediaType === "image/png" ? "png" : "jpg";
  let path = joinPath(dirname(book.opfPath), `magpie-cover.${ext}`);
  for (let n = 2; book.has(path); n++) path = joinPath(dirname(book.opfPath), `magpie-cover-${n}.${ext}`);
  book.files.set(path, image.bytes);
  const item = opf.doc.createElementNS("http://www.idpf.org/2007/opf", "item");
  item.setAttribute("id", opf.uniqueId("magpie-cover"));
  item.setAttribute("href", path.split("/").pop()!);
  item.setAttribute("media-type", image.mediaType);
  opf.section("manifest").appendChild(item);
  const id = item.getAttribute("id")!;
  const meta = opf.metas().find((m) => m.getAttribute("name") === "cover");
  if (meta) meta.setAttribute("content", id);
  else opf.addMeta({ name: "cover", content: id });
  if (opf.epub3) {
    for (const i of opf.items()) {
      const props = (i.getAttribute("properties") ?? "").replace(/\bcover-image\b/, "").trim();
      if (props !== (i.getAttribute("properties") ?? "")) props ? i.setAttribute("properties", props) : i.removeAttribute("properties");
    }
    item.setAttribute("properties", "cover-image");
  }
  opf.save();
  return [{ fixer: "cover", message: `${FROM[from]}, so it shows in Magpie and on every reader.` }];
}
