// What a book says about itself (BookInfo), what Magpie thinks it should say
// (Suggestions), and writing accepted values back into the package.
// Suggestions are the one place Magpie's guesses reach a person: they are
// shown on the review sheet with their source and never written unasked.

import { OPF_NS, byLocal, textOf, type Book, type OpfDoc } from "./epub.ts";
import { JUNK_AUTHOR, frontMatter, guessAuthor, guessTitle, isJunkTitle } from "./identify/rules.ts";

export interface BookInfo {
  title: string;
  authors: string[];
  language: string;
  series?: string;
  seriesIndex?: number;
  publisher?: string;
  year?: number;
  isbn?: string;
  description?: string;
}

/** Fields a person can review or edit. */
export type InfoField = "title" | "authors" | "series" | "seriesIndex" | "publisher" | "year" | "language" | "description" | "isbn";
export { patchFor } from "./suggestions.ts";

export type InfoPatch = Partial<BookInfo>;

export interface Suggestion {
  field: "title" | "authors";
  /** What the book says now ("" when it says nothing). */
  current: string;
  value: string;
  /** Where Magpie read it, in words. */
  source: string;
  /** 0 to 1. The review sheet leaves anything under 0.8 unticked. */
  confidence: number;
}

export function readInfo(book: Book): BookInfo {
  if (!book.opfPath) return { title: "", authors: [], language: "" };
  const opf = book.opf();
  const meta = (name: string) =>
    opf
      .metas()
      .find((m) => m.getAttribute("name") === name)
      ?.getAttribute("content") ?? undefined;
  const prop = (p: string) => opf.metas().find((m) => m.getAttribute("property") === p && !m.getAttribute("refines"));
  const collection = prop("belongs-to-collection");
  const groupPos =
    collection && opf.metas().find((m) => m.getAttribute("refines") === `#${collection.getAttribute("id")}` && m.getAttribute("property") === "group-position");
  const date = textOf(opf.dc("date")[0]);
  const year = Number(date.match(/\b(1[5-9]\d\d|20\d\d)\b/)?.[1]);
  const isbn = opf
    .dc("identifier")
    .map(textOf)
    .map((t) => t.replace(/^(urn:)?isbn:/i, "").replace(/[-\s]/g, ""))
    .find((t) => /^(97[89])?\d{9}[\dX]$/i.test(t));
  const series = meta("calibre:series") ?? (textOf(collection ?? undefined) || undefined);
  const index = Number(meta("calibre:series_index") ?? textOf(groupPos || undefined));
  return clean({
    title: textOf(opf.dc("title")[0]),
    authors: opf
      .dc("creator")
      .filter((c) => isAuthorRole(opf, c))
      .map(textOf)
      .filter(Boolean),
    language: textOf(opf.dc("language")[0]),
    series,
    seriesIndex: series && Number.isFinite(index) && index > 0 ? index : undefined,
    publisher: textOf(opf.dc("publisher")[0]) || undefined,
    year: Number.isFinite(year) ? year : undefined,
    isbn,
    description: stripTags(textOf(opf.dc("description")[0])) || undefined,
  });
}

/** Title and author guesses for books whose own metadata is missing or junk. */
export function suggest(book: Book, info = readInfo(book)): Suggestion[] {
  if (!book.opfPath) return [];
  const opf = book.opf();
  const pages = frontMatter(book, opf);
  const out: Suggestion[] = [];
  if (!info.title || isJunkTitle(info.title)) {
    const g = guessTitle(book, opf, pages);
    if (g && g.value !== info.title) out.push({ field: "title", current: info.title, value: g.value, source: g.source, confidence: confidenceOf(g.source) });
  }
  const author = info.authors[0] ?? "";
  if (!author || JUNK_AUTHOR.test(author)) {
    const g = guessAuthor(pages);
    if (g) out.push({ field: "authors", current: info.authors.join(" & "), value: g.value, source: g.source, confidence: confidenceOf(g.source) });
  }
  return out;
}

// Labelled lines ("Author: ...") are near-certain; a heading or a copyright
// line could be a dedication or a publisher.
function confidenceOf(source: string): number {
  if (/line\)|Gutenberg|marked-up/.test(source)) return 0.95;
  if (/copyright page|table of contents/.test(source)) return 0.85;
  return 0.7;
}

/** Write accepted values into the package. Only fields present in the patch change. */
export function writeInfo(book: Book, patch: InfoPatch): void {
  if (!book.opfPath) return;
  const opf = book.opf();
  if (patch.title !== undefined) setDc(opf, "title", patch.title);
  if (patch.authors !== undefined) {
    for (const c of opf.dc("creator").filter((c) => isAuthorRole(opf, c))) c.parentNode!.removeChild(c);
    // Creators go first in metadata order; the first is the one readers show.
    const md = opf.section("metadata");
    const anchor = opf.dc("title")[0]?.nextSibling ?? md.firstChild;
    for (const name of patch.authors) {
      const el = opf.doc.createElementNS("http://purl.org/dc/elements/1.1/", "dc:creator");
      el.appendChild(opf.doc.createTextNode(name));
      if (!opf.epub3) el.setAttributeNS(OPF_NS, "opf:role", "aut");
      md.insertBefore(el, anchor);
    }
  }
  if (patch.language !== undefined) setDc(opf, "language", patch.language);
  if (patch.publisher !== undefined) setDc(opf, "publisher", patch.publisher);
  if (patch.description !== undefined) setDc(opf, "description", patch.description);
  if (patch.year !== undefined) setDc(opf, "date", String(patch.year));
  if (patch.isbn !== undefined && !opf.dc("identifier").some((i) => textOf(i).replace(/[-\s]/g, "").endsWith(patch.isbn!))) {
    opf.addDc("identifier", `urn:isbn:${patch.isbn}`);
  }
  if (patch.series !== undefined || patch.seriesIndex !== undefined) {
    for (const m of opf.metas().filter((m) => /^calibre:series/.test(m.getAttribute("name") ?? ""))) m.parentNode!.removeChild(m);
    if (patch.series) {
      // calibre:series is what Kindle, Kobo and Calibre all read, in EPUB 2 and 3 alike.
      opf.addMeta({ name: "calibre:series", content: patch.series });
      if (patch.seriesIndex) opf.addMeta({ name: "calibre:series_index", content: String(patch.seriesIndex) });
    }
  }
  opf.save();
}

/** The declared cover image, if there is one. */
export function coverImage(book: Book): { path: string; mediaType: string } | null {
  if (!book.opfPath) return null;
  const opf = book.opf();
  const prop = opf.items().find((i) => /\bcover-image\b/.test(i.getAttribute("properties") ?? ""));
  const meta = opf.metas().find((m) => m.getAttribute("name") === "cover");
  const item = prop ?? (meta ? opf.itemById(meta.getAttribute("content") ?? "") : undefined);
  if (!item || !/^image\//.test(item.getAttribute("media-type") ?? "")) return null;
  const path = opf.itemPath(item);
  return book.has(path) ? { path, mediaType: item.getAttribute("media-type")! } : null;
}

function isAuthorRole(opf: OpfDoc, c: Element): boolean {
  const role = c.getAttributeNS(OPF_NS, "role") || c.getAttribute("opf:role");
  if (role) return role === "aut";
  const id = c.getAttribute("id");
  const refined = id && byLocal(opf.section("metadata"), "meta").find((m) => m.getAttribute("refines") === `#${id}` && m.getAttribute("property") === "role");
  return !refined || textOf(refined) === "aut";
}

function setDc(opf: OpfDoc, name: string, value: string) {
  const [first, ...rest] = opf.dc(name);
  for (const r of rest) r.parentNode!.removeChild(r);
  if (!value) {
    first?.parentNode!.removeChild(first);
    return;
  }
  if (!first) {
    opf.addDc(name, value);
    return;
  }
  while (first.firstChild) first.removeChild(first.firstChild);
  first.appendChild(opf.doc.createTextNode(value));
}

function stripTags(s: string) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}
