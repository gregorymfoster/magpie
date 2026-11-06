// Tiny EPUBs built in memory, so a test states exactly what's in its book.

import { zipSync, strToU8 } from "fflate";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Host } from "../src/index.ts";

export const page = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;

export function epub(
  opts: { opfMeta?: string; pages?: Record<string, string>; mimetypeLast?: boolean; extra?: Record<string, string>; manifest?: string } = {},
) {
  const pages = opts.pages ?? { "title.xhtml": page("<p>Title: Emma</p><p>Author: Jane Austen</p>"), "ch1.xhtml": page("<h2>Chapter 1</h2><p>Hi</p>") };
  const items = Object.keys(pages)
    .map((p, i) => `<item id="p${i}" href="${p}" media-type="application/xhtml+xml"/>`)
    .join("");
  const spine = Object.keys(pages)
    .map((_, i) => `<itemref idref="p${i}"/>`)
    .join("");
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${
    opts.opfMeta ??
    '<dc:identifier id="id">urn:uuid:1</dc:identifier><dc:title>Emma</dc:title><dc:creator>Jane Austen</dc:creator><dc:language>en</dc:language>'
  }<meta property="dcterms:modified">2024-01-01T00:00:00Z</meta></metadata><manifest>${items}${opts.manifest ?? ""}<item id="cov" href="cover.jpg" media-type="image/jpeg"/></manifest><spine>${spine}</spine></package>`;
  const files: Record<string, Uint8Array> = {
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "content.opf": strToU8(opf),
    "cover.jpg": jpeg(1600, 2400),
  };
  for (const [k, v] of Object.entries({ ...pages, ...opts.extra })) files[k] = strToU8(v);
  const mimetype: [Uint8Array, { level: 0 }] = [strToU8("application/epub+zip"), { level: 0 }];
  return zipSync(opts.mimetypeLast ? { ...files, mimetype } : { mimetype, ...files });
}

/** Just enough of a JPEG for its size to be read: start of image, a baseline frame header, end of image. */
export function jpeg(w: number, h: number) {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
}

/**
 * Holds the first file read whose path contains `match`, once `arm()` is called, until `open()`.
 * Lets a test stop a job halfway through a book and do something else meanwhile, the way a
 * person can while a slow disk or a big book keeps the job busy. `reached` resolves when it holds.
 */
export function pause(host: Host, match: string) {
  let armed = false;
  let release = () => {};
  let hit = () => {};
  const held = new Promise<void>((r) => (release = r));
  const reached = new Promise<void>((r) => (hit = r));
  const read = host.fs.read.bind(host.fs);
  host.fs.read = async (path) => {
    if (armed && path.includes(match)) {
      armed = false;
      hit();
      await held;
    }
    return read(path);
  };
  return { host, reached, arm: () => (armed = true), open: () => release() };
}

/** Lets everything that isn't waiting on a file or a lock run. */
export const settle = () => new Promise((r) => setTimeout(r, 30));

/** A Calibre library at dir with these books, each with a cover.jpg, the way Calibre lays one out. */
export function makeCalibre(
  dir: string,
  books: { title: string; authors: string[]; series?: string; index?: number; tags?: string[]; epub: Uint8Array | null; mobi?: Uint8Array }[],
) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "metadata.db"));
  db.exec(`
    CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, path TEXT, series_index REAL DEFAULT 1, pubdate TEXT, has_cover INTEGER DEFAULT 0);
    CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE books_authors_link (id INTEGER PRIMARY KEY, book INTEGER, author INTEGER);
    CREATE TABLE series (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE books_series_link (id INTEGER PRIMARY KEY, book INTEGER, series INTEGER);
    CREATE TABLE publishers (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE books_publishers_link (id INTEGER PRIMARY KEY, book INTEGER, publisher INTEGER);
    CREATE TABLE comments (id INTEGER PRIMARY KEY, book INTEGER, text TEXT);
    CREATE TABLE identifiers (id INTEGER PRIMARY KEY, book INTEGER, type TEXT, val TEXT);
    CREATE TABLE languages (id INTEGER PRIMARY KEY, lang_code TEXT);
    CREATE TABLE books_languages_link (id INTEGER PRIMARY KEY, book INTEGER, lang_code INTEGER, item_order INTEGER DEFAULT 0);
    CREATE TABLE data (id INTEGER PRIMARY KEY, book INTEGER, format TEXT, name TEXT);
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
    CREATE TABLE books_tags_link (id INTEGER PRIMARY KEY, book INTEGER, tag INTEGER);
    INSERT INTO languages (id, lang_code) VALUES (1, 'eng');
  `);
  books.forEach((b, i) => {
    const id = i + 1;
    const path = `${b.authors[0]}/${b.title} (${id})`;
    mkdirSync(join(dir, path), { recursive: true });
    db.prepare("INSERT INTO books (id, title, path, series_index, pubdate, has_cover) VALUES (?, ?, ?, ?, '1815-12-23', 1)").run(
      id,
      b.title,
      path,
      b.index ?? 1,
    );
    writeFileSync(join(dir, path, "cover.jpg"), jpeg(1200, 1800));
    for (const a of b.authors) {
      const aid = Number(db.prepare("INSERT INTO authors (name) VALUES (?)").run(a).lastInsertRowid);
      db.prepare("INSERT INTO books_authors_link (book, author) VALUES (?, ?)").run(id, aid);
    }
    if (b.series) {
      const sid = Number(db.prepare("INSERT INTO series (name) VALUES (?)").run(b.series).lastInsertRowid);
      db.prepare("INSERT INTO books_series_link (book, series) VALUES (?, ?)").run(id, sid);
    }
    db.prepare("INSERT INTO books_languages_link (book, lang_code) VALUES (?, 1)").run(id);
    for (const t of b.tags ?? []) {
      db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(t);
      const tid = (db.prepare("SELECT id FROM tags WHERE name = ?").get(t) as { id: number }).id;
      db.prepare("INSERT INTO books_tags_link (book, tag) VALUES (?, ?)").run(id, tid);
    }
    if (b.epub) {
      const name = `${b.title} - ${b.authors[0]}`;
      writeFileSync(join(dir, path, `${name}.epub`), b.epub);
      db.prepare("INSERT INTO data (book, format, name) VALUES (?, 'EPUB', ?)").run(id, name);
    } else if (b.mobi) {
      const name = `${b.title} - ${b.authors[0]}`;
      writeFileSync(join(dir, path, `${name}.mobi`), b.mobi);
      db.prepare("INSERT INTO data (book, format, name) VALUES (?, 'MOBI', ?)").run(id, name);
    } else {
      db.prepare("INSERT INTO data (book, format, name) VALUES (?, 'LIT', ?)").run(id, b.title);
    }
  });
  db.close();
}
