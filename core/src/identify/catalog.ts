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
const FIELDS =
  "key,title,subtitle,author_name,first_publish_year,publisher,language,subject,isbn,cover_i,ratings_average,ratings_count,series_name,series_position";

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
  ratings_average?: number;
  ratings_count?: number;
  /** The work's series, from Open Library's series records. Only returned when asked for in `fields`. */
  series_name?: string[];
  series_position?: string[];
}

/** A series found for a book, and how sure Magpie is of it. */
export interface SeriesFound {
  name: string;
  index?: number;
  confidence: number;
  source: string;
}

export interface Match {
  doc: CatalogDoc;
  by: "isbn" | "title and author" | "title";
  confidence: number;
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
export function suggestionsFrom(info: BookInfo, m: Match, description?: string, series?: SeriesFound | null): Suggestion[] {
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
  if (!info.series && series)
    out.push({
      field: "series",
      current: "",
      value: seriesValue(series.name, series.index),
      source: series.source,
      confidence: series.confidence,
      from: "catalog",
    });
  return out;
}

/** "Red Rising · 5": a series suggestion's value, which patchFor splits back into a name and a number. */
export const seriesValue = (name: string, index?: number) => (index ? `${name} · ${index}` : name);

/**
 * The matched work's series. Open Library's own series records (search's
 * series_name and series_position) come first, at the match's confidence:
 * they were right for every book checked. Many books have none yet, so a
 * book's English editions are read next, where a catalogue line like "Red
 * Rising Series, Book 5" names it. Those lines are messy, so they're parsed
 * strictly and offered unticked, unless the series is one this author's
 * other books in the Library are already in, in which case its spelling is
 * kept so the books sit together.
 */
export function seriesOf(m: Match, editions: unknown, known: string[]): SeriesFound | null {
  const source = `Open Library, matched by ${m.by}`;
  const same = (name: string) => known.find((k) => seriesKey(k) === seriesKey(name));
  const name = m.doc.series_name?.[0]?.trim();
  if (name) {
    const index = Number(m.doc.series_position?.[0]);
    return { name: same(name) ?? name, index: Number.isFinite(index) && index > 0 ? index : undefined, confidence: m.confidence, source };
  }
  const entries = ((editions as { entries?: { languages?: { key?: string }[]; series?: unknown }[] })?.entries ?? []).filter((e) =>
    e.languages?.some((l) => l.key === "/languages/eng"),
  );
  const votes = new Map<string, { names: string[]; index: number; n: number }>();
  for (const e of entries)
    for (const line of Array.isArray(e.series) ? e.series : []) {
      const p = typeof line === "string" ? parseSeriesLine(line) : null;
      if (!p) continue;
      const k = `${seriesKey(p.name)}|${p.index}`;
      const v = votes.get(k) ?? { names: [], index: p.index, n: 0 };
      v.names.push(p.name);
      v.n++;
      votes.set(k, v);
    }
  // Two lines that disagree on the number for the same series mean nothing is sure.
  const best = [...votes.values()].sort((a, b) => b.n - a.n);
  if (!best.length || best.some((v) => v !== best[0] && seriesKey(v.names[0]) === seriesKey(best[0].names[0]))) return null;
  const kept = same(best[0].names[0]);
  const spelled = best[0].names.find((n) => /[A-Z]/.test(n)) ?? best[0].names[0];
  return {
    name: kept ?? spelled,
    index: best[0].index,
    confidence: kept ? Math.min(m.confidence, 0.85) : 0.7,
    source: `Open Library, from an edition's catalogue entry`,
  };
}

export const editionsUrl = (key: string) => `${BASE}${key}/editions.json?limit=50`;

const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/**
 * "Red Rising Series, Book 5", "Red Rising Saga #6", "Discworld (8)", "Lord of
 * the rings -- v. 1", "A Song of Ice and Fire, Book Two" -> a name and a number.
 * A line with no number (often a publisher's series, "Thorndike Press large
 * print core") is no use and gives null.
 */
export function parseSeriesLine(line: string): { name: string; index: number } | null {
  const s = line.replace(/^(half-title:|his|her)\s+/i, "").trim();
  const m = s.match(/^(.*?)[\s,;:(-]*(?:#|\b(?:book|bk|v|vol|volume|no|number|part|bd)\.?\s*)?\(?(\d{1,3}|[a-z]+)\)?\.?$/i);
  if (!m) return null;
  const n = /^\d+$/.test(m[2]) ? Number(m[2]) : NUMBER_WORDS.indexOf(m[2].toLowerCase()) + 1;
  const name = m[1].replace(/[\s,;:(#-]+$/, "").trim();
  if (!n || n > 200 || !/\p{L}{2}/u.test(name) || /\b(press|library|classics|edition|print)\b/i.test(name)) return null;
  return { name: name.replace(/\s+(saga|series|trilogy|tetralogy|quartet|sequence)$/i, ""), index: n };
}

/** "The Red Rising Saga" and "Red rising" are one series. */
function seriesKey(name: string): string {
  return fold(name)
    .replace(/^the /, "")
    .replace(/ (saga|series|trilogy|tetralogy|quartet|sequence)$/, "");
}

/** Fewer ratings than this say more about a few readers than about the book, so none is shown. */
export const MIN_RATINGS = 5;

export function recordOf(m: Match): CatalogRecord {
  // A title-only match might be another book, and a rating can't wait in review to be checked, so it's kept only from a sure match.
  const ratings = m.confidence >= 0.9 ? (m.doc.ratings_count ?? 0) : 0;
  return {
    source: "openlibrary",
    key: m.doc.key,
    firstYear: m.doc.first_publish_year,
    subjects: (m.doc.subject ?? []).slice(0, 40),
    ratings,
    rating: ratings && m.doc.ratings_average ? Math.round(m.doc.ratings_average * 100) / 100 : undefined,
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
