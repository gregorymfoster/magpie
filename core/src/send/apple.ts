// The copy Apple Books gets. Books on a Mac files a sideloaded EPUB by what its
// package says, and iCloud carries that to an iPhone or iPad, so this is about
// the package more than the pages (the layout fixer already made the pages obey
// the reader's settings):
//
// - Series as EPUB 3 belongs-to-collection with collection-type "series" and a
//   group-position. That is what Books reads to put books together under a
//   series in volume order; calibre:series, which Kindle and Kobo read, means
//   nothing to it. Both stay.
// - Each author with a file-as ("Austen, Jane"), so Sort by Author puts Austen
//   under A rather than J.
// - The cover named both ways (the cover-image property and the older
//   <meta name="cover">), so the shelf never shows a blank or a first page.
// - A display options file that lets the book's own fonts through when the book
//   has some, so Books' "Original" font is the book's, not a fallback.

import { Book, OPF_NS, textOf, type OpfDoc } from "../epub.ts";
import { readInfo, coverImage } from "../info.ts";

export const DISPLAY_OPTIONS_PATH = "META-INF/com.apple.ibooks.display-options.xml";

export function toApple(epub: Uint8Array): Uint8Array {
  const book = Book.load(epub);
  if (!book.opfPath) return epub;
  const info = readInfo(book);
  const opf = book.opf();

  if (info.series) series(opf, info.series, info.seriesIndex);
  for (const c of opf.dc("creator")) fileAs(opf, c);
  cover(book, opf);
  opf.save();

  if (!book.has(DISPLAY_OPTIONS_PATH) && opf.items().some((i) => /font|opentype|truetype|sfnt|woff/.test(i.getAttribute("media-type") ?? ""))) {
    book.setText(
      DISPLAY_OPTIONS_PATH,
      '<?xml version="1.0" encoding="UTF-8"?>\n<display_options>\n  <platform name="*">\n    <option name="specified-fonts">true</option>\n  </platform>\n</display_options>\n',
    );
  }
  return book.save();
}

function series(opf: OpfDoc, name: string, index?: number) {
  const metas = opf.metas();
  const has = metas.some((m) => m.getAttribute("property") === "belongs-to-collection" && !m.getAttribute("refines") && textOf(m) === name);
  if (has) return;
  const id = opf.uniqueId("magpie-series");
  opf.addMeta({ property: "belongs-to-collection", id }, name);
  opf.addMeta({ refines: `#${id}`, property: "collection-type" }, "series");
  if (index) opf.addMeta({ refines: `#${id}`, property: "group-position" }, String(index));
}

function fileAs(opf: OpfDoc, creator: Element) {
  const name = textOf(creator);
  const sort = sortName(name);
  if (!sort || sort === name) return;
  if (creator.getAttributeNS(OPF_NS, "file-as") || creator.getAttribute("opf:file-as")) return;
  if (!opf.epub3) {
    creator.setAttributeNS(OPF_NS, "opf:file-as", sort);
    return;
  }
  let id = creator.getAttribute("id");
  if (id && opf.metas().some((m) => m.getAttribute("refines") === `#${id}` && m.getAttribute("property") === "file-as")) return;
  if (!id) creator.setAttribute("id", (id = opf.uniqueId("creator")));
  opf.addMeta({ refines: `#${id}`, property: "file-as" }, sort);
}

const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|phd|md)$/i;
const PARTICLE = /^(van|von|de|der|den|del|della|di|da|du|le|la|st\.?)$/i;

/** "Jane Austen" → "Austen, Jane"; "Ursula K. Le Guin" → "Le Guin, Ursula K."; one-word names and "Last, First" stay as they are. */
export function sortName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n || n.includes(",")) return n;
  const words = n.split(" ");
  const suffix = words.length > 2 && SUFFIX.test(words[words.length - 1].replace(/,$/, "")) ? words.pop()! : "";
  if (words.length < 2) return n;
  let i = words.length - 1;
  while (i > 1 && PARTICLE.test(words[i - 1])) i--;
  const last = words.slice(i).join(" ");
  const first = words.slice(0, i).join(" ");
  return `${last}, ${first}${suffix ? `, ${suffix}` : ""}`;
}

function cover(book: Book, opf: OpfDoc) {
  const img = coverImage(book);
  if (!img) return;
  const item = opf.items().find((i) => opf.itemPath(i) === img.path);
  if (!item) return;
  if (opf.epub3) {
    const props = (item.getAttribute("properties") ?? "").split(/\s+/).filter(Boolean);
    if (!props.includes("cover-image")) item.setAttribute("properties", [...props, "cover-image"].join(" "));
  }
  if (opf.metas().some((m) => m.getAttribute("name") === "cover")) return;
  let id = item.getAttribute("id");
  if (!id) item.setAttribute("id", (id = opf.uniqueId("cover")));
  opf.addMeta({ name: "cover", content: id });
}
