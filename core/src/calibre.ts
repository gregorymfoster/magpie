// Bringing a Calibre library over, once. Magpie reads Calibre's metadata.db
// from a copy (so a running Calibre is never disturbed), never writes to it,
// and keeps no link afterwards. Calibre's details are a person's own
// curation, so they are applied as trusted, without the review sheet.

import { join, type Host } from "./host.ts";
import type { InfoPatch } from "./info.ts";

export interface CalibreLibrary {
  path: string;
  /** Books in Calibre. */
  total: number;
  /** Books with an EPUB, which is what comes over. */
  epubs: number;
}

/** One book as it comes over: a file plus trusted details. */
export interface CalibreItem {
  title: string;
  /** Absolute path of the EPUB inside the Calibre folder, or null when there is none. */
  path: string | null;
  formats: string[];
  info: InfoPatch;
  cover?: string;
}

/** Where Calibre keeps its library: its own preferences, else ~/Calibre Library. */
export async function findCalibre(host: Host): Promise<CalibreLibrary | null> {
  const candidates: string[] = [];
  for (const prefs of [join(host.env.home, "Library/Preferences/calibre/global.py.json"), join(host.env.home, ".config/calibre/global.py.json")]) {
    if (!(await host.fs.exists(prefs))) continue;
    try {
      const p = JSON.parse(new TextDecoder().decode(await host.fs.read(prefs)));
      if (typeof p.library_path === "string") candidates.push(p.library_path);
    } catch {
      // unreadable preferences: fall through to the default location
    }
  }
  candidates.push(join(host.env.home, "Calibre Library"));
  for (const c of candidates) {
    const lib = await describeCalibre(host, c);
    if (lib) return lib;
  }
  return null;
}

export async function describeCalibre(host: Host, path: string): Promise<CalibreLibrary | null> {
  if (!(await host.fs.exists(join(path, "metadata.db")))) return null;
  const items = await readCalibre(host, path);
  return { path, total: items.length, epubs: items.filter((i) => i.path).length };
}

export async function readCalibre(host: Host, path: string): Promise<CalibreItem[]> {
  const copy = join(host.env.temp, `calibre-${Date.now()}.db`);
  await host.fs.copy(join(path, "metadata.db"), copy);
  const db = await host.sqlite.open(copy, { readonly: true });
  try {
    const rows = await db.all<Row>(SQL);
    return rows.map((r) => toItem(path, r));
  } finally {
    await db.close();
    await host.fs.remove(copy);
  }
}

interface Row {
  title: string;
  path: string;
  series_index: number | null;
  pubdate: string | null;
  has_cover: number;
  authors: string | null;
  series: string | null;
  publisher: string | null;
  description: string | null;
  isbn: string | null;
  language: string | null;
  formats: string | null;
  epub: string | null;
}

// Authors keep Calibre's own order (the link table's id), which is the order a person typed them.
const SQL = `
SELECT b.title, b.path, b.series_index, b.pubdate, b.has_cover,
  (SELECT group_concat(name, char(31)) FROM (SELECT a.name FROM books_authors_link l JOIN authors a ON a.id = l.author WHERE l.book = b.id ORDER BY l.id)) AS authors,
  (SELECT s.name FROM books_series_link l JOIN series s ON s.id = l.series WHERE l.book = b.id) AS series,
  (SELECT p.name FROM books_publishers_link l JOIN publishers p ON p.id = l.publisher WHERE l.book = b.id) AS publisher,
  (SELECT text FROM comments WHERE book = b.id) AS description,
  (SELECT val FROM identifiers WHERE book = b.id AND type = 'isbn') AS isbn,
  (SELECT g.lang_code FROM books_languages_link l JOIN languages g ON g.id = l.lang_code WHERE l.book = b.id ORDER BY l.item_order LIMIT 1) AS language,
  (SELECT group_concat(format) FROM data WHERE book = b.id) AS formats,
  (SELECT name FROM data WHERE book = b.id AND format = 'EPUB') AS epub
FROM books b ORDER BY b.id`;

function toItem(root: string, r: Row): CalibreItem {
  const info: InfoPatch = { title: r.title };
  const authors = (r.authors ?? "").split("\u001f").filter(Boolean);
  if (authors.length && !(authors.length === 1 && authors[0] === "Unknown")) info.authors = authors;
  if (r.series) {
    info.series = r.series;
    if (r.series_index) info.seriesIndex = r.series_index;
  }
  if (r.publisher) info.publisher = r.publisher;
  const year = Number(r.pubdate?.slice(0, 4));
  if (year > 1000) info.year = year;
  if (r.isbn) info.isbn = r.isbn.replace(/[-\s]/g, "");
  if (r.language) info.language = ISO639[r.language] ?? r.language;
  if (r.description)
    info.description = r.description
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const dir = join(root, r.path);
  return {
    title: r.title,
    path: r.epub ? join(dir, `${r.epub}.epub`) : null,
    formats: (r.formats ?? "").split(",").filter(Boolean),
    info,
    cover: r.has_cover ? join(dir, "cover.jpg") : undefined,
  };
}

// Calibre stores ISO 639-2; EPUB readers expect the two-letter code where one exists.
const ISO639: Record<string, string> = {
  eng: "en",
  fra: "fr",
  fre: "fr",
  deu: "de",
  ger: "de",
  spa: "es",
  ita: "it",
  nld: "nl",
  dut: "nl",
  por: "pt",
  swe: "sv",
  nor: "no",
  nob: "nb",
  dan: "da",
  fin: "fi",
  pol: "pl",
  rus: "ru",
  jpn: "ja",
  zho: "zh",
  chi: "zh",
  kor: "ko",
  ell: "el",
  gre: "el",
  lat: "la",
  tur: "tr",
  ces: "cs",
  cze: "cs",
  hun: "hu",
  heb: "he",
  ara: "ar",
  ukr: "uk",
  cat: "ca",
};
