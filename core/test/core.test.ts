// The one door, end to end on the Node host: what a person does in the app,
// as core.call()s against a real Library in a temp folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unzipSync, strFromU8 } from "fflate";
import { createCore, type CoreEvent } from "../src/index.ts";
import { nodeHost } from "../../cli/src/node-host.ts";
import { epub, page } from "./fixtures.ts";

function setup() {
  const home = mkdtempSync(join(tmpdir(), "magpie-test-"));
  const volumes = join(home, "Volumes");
  mkdirSync(volumes);
  const opened = join(home, "opened.txt");
  const core = createCore(nodeHost({ MAGPIE_HOME: home, MAGPIE_VOLUMES: volumes, MAGPIE_OPENED: opened }));
  const file = (name: string, bytes: Uint8Array) => {
    const p = join(home, "Downloads", name);
    mkdirSync(join(home, "Downloads"), { recursive: true });
    writeFileSync(p, bytes);
    return p;
  };
  return { home, volumes, opened, core, file };
}

const unknownAuthor = () =>
  epub({ opfMeta: '<dc:identifier id="id">urn:uuid:2</dc:identifier><dc:title>Emma</dc:title><dc:creator>Unknown</dc:creator><dc:language>en</dc:language>' });

test("first launch opens an empty Library at ~/Books/Magpie", async () => {
  const { core, home } = setup();
  const s = await core.call("app.state");
  assert.equal(s.library.status, "open");
  assert.equal(s.library.path, join(home, "Books/Magpie"));
  assert.deepEqual(s.counts, { all: 0, review: 0, fixed: 0, removed: 0 });
  for (const d of ["books", "originals", "covers", "backups", "library.db"]) assert.ok(existsSync(join(home, "Books/Magpie", d)), d);
});

test("importing copies the book in, fixes it silently, keeps the original and names files without spaces", async () => {
  const { core, file, home } = setup();
  await core.call("app.state");
  const src = file("emma (1).epub", epub({ mimetypeLast: true }));
  const job = await core.call("books.import", { paths: [src] });
  assert.equal(job.total, 1);
  await core.idle();
  const [b] = await core.call("books.list");
  assert.equal(b.title, "Emma");
  assert.deepEqual(b.authors, ["Jane Austen"]);
  assert.equal(b.state, "fixed");
  const d = await core.call("books.get", { id: b.id });
  assert.equal(d.file, join(home, "Books/Magpie/books/Jane-Austen/Emma.epub"));
  assert.deepEqual(readFileSync(d.original), readFileSync(src), "original kept byte for byte");
  assert.equal(Object.keys(unzipSync(readFileSync(d.file)))[0], "mimetype");
  assert.ok(existsSync(src), "the source file is copied, not moved");
});

test("a folder imports every EPUB inside it; duplicates and non-books get a sentence", async () => {
  const { core, file, home } = setup();
  await core.call("app.state");
  file("a.epub", epub());
  file("copy-of-a.epub", epub());
  file("notes.pdf", new TextEncoder().encode("%PDF-1.4"));
  mkdirSync(join(home, "Downloads/sub"));
  writeFileSync(join(home, "Downloads/sub/b.epub"), unknownAuthor());
  writeFileSync(join(home, "Downloads/broken.epub"), new TextEncoder().encode("not a zip"));
  await core.call("books.import", { paths: [join(home, "Downloads"), join(home, "Downloads/notes.pdf")] });
  await core.idle();
  const [job] = (await core.call("app.state")).jobs;
  const outcomes = job.results.map((r) => r.outcome).sort();
  assert.deepEqual(outcomes, ["added", "added", "duplicate", "unreadable", "unreadable"]);
  assert.match(job.results.find((r) => r.label === "notes.pdf")!.message!, /only reads EPUB/);
  assert.match(job.results.find((r) => r.label === "broken.epub")!.message!, /isn't an EPUB/);
});

const encryption = (algorithm: string) =>
  `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${algorithm}"/><CipherData><CipherReference URI="ch1.xhtml"/></CipherData></EncryptedData></encryption>`;

test("a book with DRM is refused with a sentence and nothing is kept; obfuscated fonts are fine", async () => {
  const { core, file, home } = setup();
  await core.call("app.state");
  file(
    "adobe.epub",
    epub({ extra: { "META-INF/encryption.xml": encryption("http://www.w3.org/2001/04/xmlenc#aes128-cbc"), "META-INF/rights.xml": "<rights/>" } }),
  );
  file("apple.epub", epub({ extra: { "META-INF/sinf.xml": "<fairplay/>" } }));
  file("lcp.epub", epub({ extra: { "META-INF/license.lcpl": "{}" } }));
  file("fonts.epub", epub({ extra: { "META-INF/encryption.xml": encryption("http://www.idpf.org/2008/embedding") } }));
  await core.call("books.import", { paths: [join(home, "Downloads")] });
  await core.idle();
  const [job] = (await core.call("app.state")).jobs;
  const by = Object.fromEntries(job.results.map((r) => [r.label, r]));
  for (const name of ["adobe.epub", "apple.epub", "lcp.epub"]) {
    assert.equal(by[name].outcome, "unreadable", name);
    assert.match(by[name].message!, /DRM/);
  }
  assert.deepEqual(job.results.filter((r) => r.outcome === "added").length, 1);
  assert.equal(readdirSync(join(home, "Books/Magpie/originals")).length, 1);
});

test("suggested details wait for review, and accepting renames the file; undo puts it back", async () => {
  const { core, file, home } = setup();
  await core.call("app.state");
  await core.call("books.import", { paths: [file("emma.epub", unknownAuthor())] });
  await core.idle();
  const [b] = await core.call("books.list", { state: "review" });
  const d = await core.call("books.get", { id: b.id });
  assert.deepEqual(
    d.report.suggestions.map((s) => [s.field, s.value]),
    [["authors", "Jane Austen"]],
  );
  assert.deepEqual(d.authors, ["Unknown"], "nothing written until accepted");

  await core.call("books.review", { decisions: [{ id: b.id, accept: { authors: ["Jane Austen"] }, dismiss: [] }] });
  const after = await core.call("books.get", { id: b.id });
  assert.equal(after.state, "fixed");
  assert.equal(after.file, join(home, "Books/Magpie/books/Jane-Austen/Emma.epub"));
  assert.match(strFromU8(unzipSync(readFileSync(after.file))["content.opf"]), /Jane Austen/);
  assert.equal((await core.call("app.state")).undo, "Accept suggested details");

  assert.deepEqual(await core.call("history.undo"), { undone: "Accept suggested details" });
  const back = await core.call("books.get", { id: b.id });
  assert.equal(back.state, "review");
  assert.deepEqual(back.authors, ["Unknown"]);
  assert.ok(!existsSync(after.file));
});

test("turning a suggestion down keeps what the book says and clears the review", async () => {
  const { core, file } = setup();
  await core.call("app.state");
  await core.call("books.import", { paths: [file("emma.epub", unknownAuthor())] });
  await core.idle();
  const [b] = await core.call("books.list");
  await core.call("books.review", { decisions: [{ id: b.id, accept: {}, dismiss: ["authors"] }] });
  const d = await core.call("books.get", { id: b.id });
  assert.equal(d.state, "fixed");
  assert.deepEqual(d.report.suggestions, []);
});

test("removing sends a book to Removed; undo and restore bring it back", async () => {
  const { core, file } = setup();
  await core.call("app.state");
  await core.call("books.import", { paths: [file("a.epub", epub())] });
  await core.idle();
  const [b] = await core.call("books.list");
  await core.call("books.remove", { ids: [b.id] });
  assert.equal((await core.call("books.list")).length, 0);
  assert.equal((await core.call("books.list", { removed: true })).length, 1);
  await core.call("history.undo");
  assert.equal((await core.call("books.list")).length, 1);
  await core.call("books.remove", { ids: [b.id] });
  await core.call("books.restore", { ids: [b.id] });
  assert.equal((await core.call("books.list")).length, 1);
  await core.call("books.remove", { ids: [b.id] });
  assert.deepEqual(await core.call("books.purge"), { deleted: 1 });
  assert.equal((await core.call("app.state")).counts.removed, 0);
});

test("search matches title and author", async () => {
  const { core, file } = setup();
  await core.call("app.state");
  await core.call("books.import", { paths: [file("a.epub", epub())] });
  await core.idle();
  assert.equal((await core.call("books.list", { search: "austen" })).length, 1);
  assert.equal((await core.call("books.list", { search: "dickens" })).length, 0);
});

test("a Calibre library comes over once, with Calibre's details trusted and its covers", async () => {
  const { core, home } = setup();
  await core.call("app.state");
  const cal = join(home, "Calibre Library");
  makeCalibre(cal, [
    {
      title: "Emma",
      authors: ["Jane Austen"],
      series: "Novels",
      index: 2,
      epub: epub({ opfMeta: "<dc:title>emma_final(2)</dc:title><dc:language>en</dc:language>" }),
    },
    { title: "Mobi Only", authors: ["Someone"], epub: null },
  ]);
  const found = await core.call("calibre.find");
  assert.deepEqual(found, { path: cal, total: 2, epubs: 1 });
  await core.call("calibre.import", { path: cal });
  await core.idle();
  const [b] = await core.call("books.list");
  assert.equal(b.title, "Emma");
  assert.equal(b.series, "Novels");
  assert.equal(b.seriesIndex, 2);
  assert.equal(b.state, "fixed", "Calibre's details are trusted, not sent to review");
  assert.ok(b.cover && existsSync(b.cover), "Calibre's cover shows when the book has none");
  const [job] = (await core.call("app.state")).jobs;
  assert.deepEqual(
    job.results.map((r) => r.outcome),
    ["added", "skipped"],
  );
});

test("Send to Kindle opens a new Mail message addressed to Kindle with the book attached, and never sends it", async () => {
  const { core, file, opened } = setup();
  await core.call("app.state");
  await core.call("books.import", { paths: [file("a.epub", epub())] });
  await core.idle();
  const [b] = await core.call("books.list");
  await assert.rejects(core.call("send.kindle", { ids: [b.id] }), /Send to Kindle address/);
  await assert.rejects(core.call("settings.set", { kindleAddress: "me@gmail.com" }), /kindle\.com/);
  await core.call("settings.set", { kindleAddress: "greg_abc@kindle.com" });
  const { attachments } = await core.call("send.kindle", { ids: [b.id] });
  const draft = JSON.parse(readFileSync(opened, "utf8").replace(/^mail /, ""));
  assert.equal(draft.to, "greg_abc@kindle.com");
  assert.equal(draft.subject, "Emma");
  assert.deepEqual(draft.attachments, attachments);
  assert.match(attachments[0], /\/Jane-Austen-Emma\.epub$/);
  assert.ok(unzipSync(readFileSync(attachments[0]))["mimetype"]);
});

test("Send to Kobo converts to KEPUB on the reader and leaves the Library's EPUB alone", async () => {
  const { core, file, volumes } = setup();
  await core.call("app.state");
  await core.call("books.import", { paths: [file("a.epub", epub())] });
  await core.idle();
  const kobo = join(volumes, "KOBOeReader");
  mkdirSync(join(kobo, ".kobo"), { recursive: true });
  const [dev] = await core.call("devices.list");
  assert.equal(dev.name, "Kobo");
  const [b] = await core.call("books.list");
  await core.call("send.kobo", { ids: [b.id], device: dev.path });
  await core.idle();
  const sent = join(kobo, "Magpie", "Jane-Austen-Emma.kepub.epub");
  assert.match(strFromU8(unzipSync(readFileSync(sent))["ch1.xhtml"]), /<span class="koboSpan" id="kobo\.1\.1">Chapter 1<\/span>/);
  const d = await core.call("books.get", { id: b.id });
  assert.doesNotMatch(strFromU8(unzipSync(readFileSync(d.file))["ch1.xhtml"]), /koboSpan/);
  assert.deepEqual(readdirSync(join(kobo, "Magpie")), ["Jane-Austen-Emma.kepub.epub"]);
});

test("a remembered Library on an unplugged disk reports missing instead of making a new one", async () => {
  const { home } = setup();
  mkdirSync(join(home, ".config/magpie"), { recursive: true });
  const config = process.platform === "darwin" ? join(home, "Library/Application Support/Magpie") : join(home, ".config/magpie");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "config.json"), JSON.stringify({ libraryPath: "/Volumes/Gone/Magpie" }));
  const core = createCore(nodeHost({ MAGPIE_HOME: home }));
  const s = await core.call("app.state");
  assert.deepEqual(s.library, { status: "missing", path: "/Volumes/Gone/Magpie" });
});

test("events: an import pushes job progress and a library change", async () => {
  const { core, file } = setup();
  await core.call("app.state");
  const seen: CoreEvent["type"][] = [];
  core.on((e) => seen.push(e.type));
  await core.call("books.import", { paths: [file("a.epub", epub())] });
  await core.idle();
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(seen.includes("job"));
  assert.ok(seen.includes("library.changed"));
});

test("an unexpected host failure reaches people as a sentence, and diagnostics keep the detail without paths", async () => {
  const { home } = setup();
  const host = nodeHost({ MAGPIE_HOME: home });
  let fail = false;
  const core = createCore({ ...host, fs: { ...host.fs, exists: (p) => (fail ? Promise.reject("os error 2 at /Users/greg/Emma.epub") : host.fs.exists(p)) } });
  await core.call("app.state");
  fail = true;
  await assert.rejects(core.call("calibre.find", { path: "/somewhere" }), /Copy Diagnostics/);
  fail = false;
  const d = await core.call("app.diagnostics");
  assert.match(d, /Last error: calibre\.find: os error 2 at <path>/);
  assert.doesNotMatch(d, /Emma/);
});

test("diagnostics leave out titles", async () => {
  const { core, file } = setup();
  await core.call("app.state");
  await core.call("books.import", { paths: [file("a.epub", epub({ pages: { "t.xhtml": page("<p>Secret Title</p>") } }))] });
  await core.idle();
  const d = await core.call("app.diagnostics");
  assert.match(d, /^Magpie /);
  assert.doesNotMatch(d, /Emma|Austen|Secret/);
});

function makeCalibre(dir: string, books: { title: string; authors: string[]; series?: string; index?: number; epub: Uint8Array | null }[]) {
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
    writeFileSync(join(dir, path, "cover.jpg"), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    for (const a of b.authors) {
      const aid = Number(db.prepare("INSERT INTO authors (name) VALUES (?)").run(a).lastInsertRowid);
      db.prepare("INSERT INTO books_authors_link (book, author) VALUES (?, ?)").run(id, aid);
    }
    if (b.series) {
      const sid = Number(db.prepare("INSERT INTO series (name) VALUES (?)").run(b.series).lastInsertRowid);
      db.prepare("INSERT INTO books_series_link (book, series) VALUES (?, ?)").run(id, sid);
    }
    db.prepare("INSERT INTO books_languages_link (book, lang_code) VALUES (?, 1)").run(id);
    if (b.epub) {
      const name = `${b.title} - ${b.authors[0]}`;
      writeFileSync(join(dir, path, `${name}.epub`), b.epub);
      db.prepare("INSERT INTO data (book, format, name) VALUES (?, 'EPUB', ?)").run(id, name);
    } else {
      db.prepare("INSERT INTO data (book, format, name) VALUES (?, 'MOBI', ?)").run(id, b.title);
    }
  });
  db.close();
}
