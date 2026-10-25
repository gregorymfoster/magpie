// Rules that read a book's own pages the way a librarian would: the title
// page, the copyright page, the Project Gutenberg header. They come first
// because they are fast, explainable and, on the bench, right where a 1.5B
// model was wrong. A catalog lookup or a model can come later, behind the
// same Guess shape.

import { decodeUtf8, type Book, type OpfDoc } from "../epub.ts";

export const JUNK_AUTHOR = /^(unknown( author)?|author|n\/?a|none|-+|\s*)$/i;

export function isJunkTitle(t: string): boolean {
  const s = t.trim();
  return (
    !s ||
    (/^(untitled|unknown|title|book|document|manuscript|ebook)\b/i.test(s) && s.split(/\s+/).length <= 2) ||
    /_|\.(epub|docx?|pdf|txt)$|\(\d+\)$|\bfinal\b|\bv\d+\b|\bexport\b/i.test(s) ||
    /^\d{6,}/.test(s) ||
    /^[a-z0-9]+(-[a-z0-9]+)+$/.test(s)
  );
}

export interface Guess {
  value: string;
  /** Where it was read, in words: "the title page (\"Author:\" line)". */
  source: string;
}

export interface Page {
  path: string;
  html: string;
  /** Text of each block-level element, in order. */
  lines: string[];
}

/** The first few non-chapter documents in reading order (cover, title page, copyright). */
export function frontMatter(book: Book, opf: OpfDoc, max = 4): Page[] {
  const out: Page[] = [];
  for (const ref of opf.itemrefs()) {
    const item = opf.itemById(ref.getAttribute("idref") ?? "");
    if (!item) continue;
    const path = opf.itemPath(item);
    if (!book.has(path)) continue;
    const html = decodeUtf8(book.files.get(path)!);
    const lines = blocks(html);
    if (lines.length) out.push({ path, html, lines });
    if (out.length >= max) break;
  }
  return out;
}

function blocks(html: string): string[] {
  const body = html.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  return body
    .split(/<\/?(?:p|h[1-6]|div|section|li|br|td|header|span class="[^"]*(?:title|author)[^"]*")[^>]*>/i)
    .map((s) =>
      decodeEntities(s.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const SMALL = new Set("a an and as at but by de del der des di du en et for from in into la le les nor of on or the to und van von with".split(" "));

/** "THE HOUND OF THE BASKERVILLES" -> "The Hound of the Baskervilles". Leaves mixed case alone. */
export function unshout(s: string): string {
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w, i) =>
      i > 0 && SMALL.has(w) ? w : w.replace(/^(\p{L})/u, (c) => c.toUpperCase()).replace(/^(d'|l'|mc)(\p{L})/u, (_, p, c) => p + c.toUpperCase()),
    )
    .join("")
    .replace(/(\b\p{L}\.)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}

export function guessTitle(book: Book, opf: OpfDoc, pages: Page[]): Guess | undefined {
  for (const p of pages) {
    for (const l of p.lines) {
      const m = l.match(/^Title:\s*(.+)$/i);
      if (m) return { value: m[1].trim(), source: 'the title page ("Title:" line)' };
    }
  }
  for (const p of pages) {
    const m = p.html.match(/<(\w+)[^>]*epub:type="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/);
    if (m) return { value: unshout(blocks(m[2]).join(" ")), source: "the title page (marked-up title)" };
  }
  for (const p of pages) {
    for (const l of p.lines) {
      const m = l.match(/^The Project Gutenberg e?Book,? of (.+?)(?:, by .+)?$/i);
      if (m) return { value: m[1].trim(), source: "the Project Gutenberg header" };
    }
  }
  const ncx = opf.items().find((i) => i.getAttribute("media-type") === "application/x-dtbncx+xml");
  if (ncx && book.has(opf.itemPath(ncx))) {
    const m = book.text(opf.itemPath(ncx)).match(/<docTitle>\s*<text>([^<]+)<\/text>/);
    if (m && !isJunkTitle(m[1])) return { value: decodeEntities(m[1].trim()), source: "the table of contents file" };
  }
  for (const p of pages) {
    const m = p.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (!m) continue;
    const h1 = blocks(m[1]).join(" ");
    if (!h1 || /^(contents|table of contents|chapter\b|cover)/i.test(h1)) continue;
    // a copyright page often repeats the title in proper case
    for (const q of pages)
      for (const l of q.lines) if (l.toLowerCase() === h1.toLowerCase() && l !== h1) return { value: l, source: "the title page and copyright page" };
    return { value: unshout(h1), source: "the title page heading" };
  }
  return;
}

export function guessAuthor(pages: Page[]): Guess | undefined {
  const clean = (s: string) =>
    unshout(
      s
        .replace(/[.,;]+$/, "")
        .replace(/\s*\(.*\)\s*$/, "")
        .trim(),
    );
  const rules: [RegExp, string][] = [
    [/^Author:\s*(.+)$/i, 'the title page ("Author:" line)'],
    [/^The Project Gutenberg e?Book,? of .+?, by (.+)$/i, "the Project Gutenberg header"],
    [/^(?:written )?by\s+(.+)$/i, 'the title page ("By" line)'],
    [/^Copyright\s*(?:©|\(c\))?\s*(?:\d{4}(?:[-–]\d{4})?)?\s*(?:by\s+)?(.+?)(?:\.|\s*All rights reserved.*)?$/i, "the copyright page"],
    [/^.+?, by (.+?)\.?(?: First published.*)?$/i, "the copyright page"],
  ];
  for (const [re, source] of rules) {
    for (const p of pages) {
      for (const l of p.lines) {
        const m = l.match(re);
        if (m) {
          const v = clean(m[1]);
          if (v && v.split(/\s+/).length <= 6 && !JUNK_AUTHOR.test(v)) return { value: v, source };
        }
      }
    }
  }
  for (const p of pages) {
    const m = p.html.match(/<(\w+)[^>]*class="[^"]*\b(?:author|byline)\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/i);
    if (m) {
      const v = clean(
        blocks(m[2])
          .join(" ")
          .replace(/^by\s+/i, ""),
      );
      if (v) return { value: v, source: "the title page (author line)" };
    }
  }
  return;
}

const STOPWORDS: Record<string, string[]> = {
  en: ["the", "and", "of", "to", "was", "he", "she", "that", "with", "his"],
  de: ["der", "die", "und", "das", "nicht", "sie", "ich", "ist", "mit", "sich"],
  fr: ["le", "la", "les", "et", "des", "est", "une", "que", "dans", "il"],
  es: ["el", "la", "que", "y", "los", "las", "del", "una", "por", "con"],
  it: ["il", "che", "di", "la", "e", "non", "per", "una", "del", "con"],
  nl: ["de", "het", "een", "en", "van", "niet", "dat", "zijn", "hij", "met"],
  nb: ["og", "det", "som", "jeg", "ikke", "han", "hun", "til", "med", "er"],
};

export function guessLanguage(book: Book, opf: OpfDoc): Guess {
  const counts = new Map<string, number>();
  const docs = opf
    .itemrefs()
    .map((r) => opf.itemById(r.getAttribute("idref") ?? ""))
    .filter(Boolean) as Element[];
  let sample = "";
  for (const d of docs) {
    const path = opf.itemPath(d);
    if (!book.has(path)) continue;
    const html = decodeUtf8(book.files.get(path)!);
    const m = html.match(/<html[^>]*\s(?:xml:)?lang="([^"]+)"/i);
    if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    if (sample.length < 20000) sample += " " + html.replace(/<[^>]+>/g, " ");
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (best) return { value: best[0], source: "the language tags on its pages" };
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  const score = Object.entries(STOPWORDS).map(([lang, sw]) => [lang, words.filter((w) => sw.includes(w)).length] as const);
  score.sort((a, b) => b[1] - a[1]);
  return score[0][1] > 0 ? { value: score[0][0], source: "common words in the text" } : { value: "en", source: "a default, since the text gave no clue" };
}
