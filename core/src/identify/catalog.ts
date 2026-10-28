// Look Up Details: asking Open Library (openlibrary.org, open data, no key)
// for what a book's own pages couldn't say. Only the title, author and ISBN
// are sent; the book never is. It runs only when a person asks for it, and
// everything it finds waits on the review sheet like any other suggestion.
//
// Matching is deliberately strict. An ISBN match is near-certain; otherwise
// the title and an author's surname must both agree. Anything weaker starts
// unticked or isn't suggested at all: a wrong year is worse than no year.

import type { CatalogRecord, FixReport } from "../fix.ts";
import type { BookInfo, Suggestion } from "../info.ts";
import { JUNK_AUTHOR, isJunkTitle } from "./rules.ts";

const BASE = "https://openlibrary.org";
const FIELDS = "key,title,subtitle,author_name,first_publish_year,publisher,language,subject,isbn,cover_i";

export interface CatalogDoc {
  key: string;
  title: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  publisher?: string[];
  language?: string[];
  subject?: string[];
  isbn?: string[];
  /** Open Library's cover picture for the work, if it has one. */
  cover_i?: number;
}

export interface Match {
  doc: CatalogDoc;
  by: "isbn" | "title and author" | "title";
  confidence: number;
}

/** Fields a lookup could fill. A book with all of them has nothing to look up. */
export function wants(info: BookInfo): boolean {
  return !info.year || !info.publisher || !info.language || !info.description || !info.authors.length || JUNK_AUTHOR.test(info.authors[0] ?? "");
}

/** A book whose cover Magpie drew, or whose own is small or damaged: Look Up Details looks for the real one. */
export function wantsCover(report: FixReport): boolean {
  return !!report.coverMade || !!report.todos?.some((t) => t.action === "cover");
}

/** The large picture for a cover id. `default=false` makes a missing one a 404 rather than a blank image. */
export const coverUrl = (id: number) => `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`;

/** The search URL for a book, or null when there's too little to search on. */
export function searchUrl(info: BookInfo): string | null {
  const q = new URLSearchParams();
  if (info.isbn) q.set("isbn", info.isbn);
  else {
    if (!info.title || isJunkTitle(info.title)) return null;
    q.set("title", info.title.split(/[:;]/)[0].trim());
    const author = info.authors[0];
    if (author && !JUNK_AUTHOR.test(author)) q.set("author", author);
  }
  q.set("fields", FIELDS);
  q.set("limit", "5");
  return `${BASE}/search.json?${q}`;
}

export const workUrl = (key: string) => `${BASE}${key}.json`;

/** The search result that is this book, if one clearly is. */
export function match(info: BookInfo, docs: CatalogDoc[]): Match | null {
  if (info.isbn) {
    const doc = docs.find((d) => d.isbn?.some((i) => sameIsbn(i, info.isbn!)));
    return doc ? { doc, by: "isbn", confidence: 0.95 } : null;
  }
  const want = titleKey(info.title);
  const sameTitle = docs.filter((d) => titleKey(d.title) === want || titleKey(`${d.title}: ${d.subtitle ?? ""}`) === titleKey(info.title));
  const author = info.authors.find((a) => !JUNK_AUTHOR.test(a));
  if (author) {
    const doc = sameTitle.find((d) => d.author_name?.some((n) => surname(n) === surname(author)));
    return doc ? { doc, by: "title and author", confidence: 0.9 } : null;
  }
  // No author to check against: only an unambiguous title, and left unticked.
  const authors = new Set(sameTitle.map((d) => (d.author_name ?? []).map(surname).join("|")));
  return sameTitle.length && authors.size === 1 ? { doc: sameTitle[0], by: "title", confidence: 0.7 } : null;
}

/** What the match adds to the book: only fields it lacks. */
export function suggestionsFrom(info: BookInfo, m: Match, description?: string): Suggestion[] {
  const out: Suggestion[] = [];
  const source = `Open Library, matched by ${m.by}`;
  const add = (field: Suggestion["field"], current: string, value: string | undefined, confidence = m.confidence) => {
    if (value && value !== current) out.push({ field, current, value, source, confidence, from: "catalog" });
  };
  const d = m.doc;
  if (!info.authors.length || JUNK_AUTHOR.test(info.authors[0])) add("authors", info.authors.join(" & "), d.author_name?.slice(0, 3).join(" & "));
  if (!info.year) add("year", "", d.first_publish_year ? String(d.first_publish_year) : undefined);
  // Many editions share a work, so a publisher is only right for the exact edition: ISBN matches only.
  if (!info.publisher && m.by === "isbn") add("publisher", "", d.publisher?.[0]);
  if (!info.language && d.language?.length === 1) add("language", "", LANG[d.language[0]]);
  if (!info.description) add("description", "", description);
  return out;
}

export function recordOf(m: Match): CatalogRecord {
  return {
    source: "openlibrary",
    key: m.doc.key,
    firstYear: m.doc.first_publish_year,
    subjects: (m.doc.subject ?? []).slice(0, 40),
    at: new Date().toISOString(),
  };
}

/** A work's description, which comes as a string or as { value }. Markdown links and the source line are dropped. */
export function descriptionOf(work: unknown): string | undefined {
  const raw = (work as { description?: string | { value?: string } })?.description;
  const text = typeof raw === "string" ? raw : raw?.value;
  if (!text) return undefined;
  const clean = text
    .replace(/\r/g, "")
    .split(/\n-{3,}\n|\n\(\[source\]/)[0]
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clean.length > 20 ? clean.slice(0, 4000) : undefined;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** "The Great Work of Your Life: A Guide…" -> "great work of your life" */
function titleKey(t: string): string {
  return fold(t.split(/[:;]/)[0]).replace(/^(the|a|an) /, "");
}

/** "Le Guin, Ursula K." and "Ursula K. Le Guin" both -> "guin" */
function surname(name: string): string {
  const n = name.includes(",") ? name.split(",")[0] : name;
  const words = fold(n).split(" ");
  return words[words.length - 1] ?? "";
}

function sameIsbn(a: string, b: string): boolean {
  const norm = (s: string) => {
    const x = s.replace(/[-\s]/g, "").toUpperCase();
    return x.length === 10 ? `978${x.slice(0, 9)}` : x.slice(0, 12);
  };
  return norm(a) === norm(b);
}

// Open Library uses MARC codes; books use BCP 47.
const LANG: Record<string, string> = {
  eng: "en",
  fre: "fr",
  fra: "fr",
  ger: "de",
  deu: "de",
  spa: "es",
  ita: "it",
  por: "pt",
  dut: "nl",
  nld: "nl",
  swe: "sv",
  nor: "no",
  dan: "da",
  fin: "fi",
  pol: "pl",
  rus: "ru",
  jpn: "ja",
  chi: "zh",
  zho: "zh",
  kor: "ko",
  ara: "ar",
  heb: "he",
  gre: "el",
  lat: "la",
  tur: "tr",
  cze: "cs",
  hun: "hu",
};
