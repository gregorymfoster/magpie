// The one door, end to end on the Node host: what a person does in the app,
// as core.call()s against a real Library in a temp folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unzipSync, strFromU8 } from "fflate";
import { createCore, patchFor, type CoreEvent } from "../src/index.ts";
import { nodeHost } from "../../cli/src/node-host.ts";
import { epub, page } from "./fixtures.ts";

/** Sorting by rules alone, so these tests don't depend on the model being downloaded. organize.test.ts covers the model. */
const NO_MODEL = "/no-model";

function setup(web?: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), "magpie-test-"));
  const volumes = join(home, "Volumes");
  mkdirSync(volumes);
  const opened = join(home, "opened.txt");
  const MAGPIE_WEB = join(home, "web.json");
  writeFileSync(MAGPIE_WEB, JSON.stringify(web ?? {}));
  const core = createCore(nodeHost({ MAGPIE_HOME: home, MAGPIE_VOLUMES: volumes, MAGPIE_OPENED: opened, MAGPIE_WEB, MAGPIE_MODEL: NO_MODEL }));
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

test("a book with DRM comes in untouched with a warning, and can't be fixed, edited or sent; obfuscated fonts aren't DRM", async () => {
  const { core, file, home } = setup();
  await core.call("app.state");
  const adobe = epub({ extra: { "META-INF/encryption.xml": encryption("http://www.w3.org/2001/04/xmlenc#aes128-cbc"), "META-INF/rights.xml": "<rights/>" } });
  file("adobe.epub", adobe);
  file(
    "apple.epub",
    epub({
      opfMeta: '<dc:identifier id="id">urn:uuid:9</dc:identifier><dc:title>Persuasion</dc:title><dc:creator>Jane Austen</dc:creator>',
      extra: { "META-INF/sinf.xml": "<fairplay/>" },
    }),
  );
  file(
    "lcp.epub",
    epub({
      opfMeta: '<dc:identifier id="id">urn:uuid:8</dc:identifier><dc:title>Lady Susan</dc:title><dc:creator>Jane Austen</dc:creator>',
      extra: { "META-INF/license.lcpl": "{}" },
    }),
  );
  file(
    "fonts.epub",
    epub({
      opfMeta: '<dc:identifier id="id">urn:uuid:7</dc:identifier><dc:title>Sanditon</dc:title><dc:creator>Jane Austen</dc:creator>',
      extra: { "META-INF/encryption.xml": encryption("http://www.idpf.org/2008/embedding") },
    }),
  );
  await core.call("books.import", { paths: [join(home, "Downloads")] });
  await core.idle();
  const [job] = (await core.call("app.state")).jobs;
  assert.deepEqual(
    job.results.map((r) => r.outcome),
    ["added", "added", "added", "added"],
  );
  assert.equal(job.results.filter((r) => /locked with DRM/.test(r.message ?? "")).length, 3);

  const locked = await core.call("books.list", { state: "locked" });
  assert.deepEqual(locked.map((b) => b.title).sort(), ["Emma", "Lady Susan", "Persuasion"]);
  assert.notEqual((await core.call("books.list", { search: "Sanditon" }))[0].state, "locked");
  const emma = await core.call("books.get", { id: locked.find((b) => b.title === "Emma")!.id });
  assert.deepEqual(new Uint8Array(readFileSync(emma.file)), adobe, "kept byte for byte");
  assert.equal(emma.report.changes.length, 0);

  await assert.rejects(core.call("books.edit", { id: emma.id, patch: { title: "Emma!" } }), /DRM/);
  await core.call("settings.set", { kindleAddress: "me@kindle.com" });
  await assert.rejects(core.call("send.kindle", { ids: [emma.id] }), /DRM/);
  await assert.rejects(core.call("books.preview", { id: emma.id }), /DRM/);
});

test("preview gives one inert, self-contained page per chapter, named from the contents, for the fixed book and its original", async () => {
  const { core, file } = setup();
  await core.call("app.state");
  const nav = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">One: The Ball</a></li></ol></nav></body></html>`;
  const src = file(
    "emma.epub",
    epub({
      pages: {
        "ch1.xhtml": page(
          '<h2>Chapter 1</h2><p onclick="steal()" style="background:url(pic.png)">Emma Woodhouse, <a href="https://example.com/x">handsome</a>.</p><img src="pic.png"/><img src="https://example.com/track.gif"/><script>steal()</script>',
        ).replace("<title>t</title>", '<title>t</title><link rel="stylesheet" href="style.css"/>'),
        "ch2.xhtml": page("<h2>Chapter 2</h2><p>Mr. Knightley.</p>"),
      },
      manifest: '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      extra: {
        "style.css": "@import url(https://example.com/a.css); @font-face { font-family: B; src: url(f.woff) } p { text-indent: 1em }",
        "pic.png": "PNG",
        "f.woff": "WOFF",
        "nav.xhtml": nav,
        // the original's container points at a package that isn't there; the fix finds it
        "META-INF/container.xml":
          '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      },
    }),
  );
  await core.call("books.import", { paths: [src] });
  await core.idle();
  const [b] = await core.call("books.list");

  const p = await core.call("books.preview", { id: b.id });
  assert.equal(p.chapter, 0);
  assert.equal(p.chapters.length, 2);
  assert.equal(p.chapters[1].title, "Chapter 2", "a page the contents don't name is called by its heading");
  assert.match(p.html, /^<!DOCTYPE html>\n<html/, "one doctype, and the XML declaration doesn't become a comment");
  assert.match(p.html, /<style>[^<]*text-indent: 1em/, "the stylesheet is inlined");
  assert.match(p.html, /src: url\("data:font\/woff;base64,/, "fonts become data URLs");
  assert.match(p.html, /<img src="data:image\/png;base64,UE5H">/);
  assert.match(p.html, /background:url\(&quot;data:image\/png/);
  assert.doesNotMatch(p.html, /<script|onclick|example\.com|@import/, "nothing runs and nothing is fetched");
  assert.match(p.html, /<a data-link="">handsome<\/a>/);

  const last = await core.call("books.preview", { id: b.id, chapter: 99 });
  assert.equal(last.chapter, 1, "a chapter past the end is the last one");
  assert.match(last.html, /Mr\. Knightley/);

  // The original has no package Magpie can find, so its pages come in zip order, named by their headings.
  const before = await core.call("books.preview", { id: b.id, original: true });
  assert.deepEqual(
    before.chapters.map((c) => c.title),
    ["Chapter 1", "Chapter 2"],
  );
  assert.equal((await core.call("books.preview", { id: b.id })).chapters[0].title, "One: The Ball");
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

test("search ignores accents and case; title sort is numeric and skips The, A and An", async () => {
  const { core, file } = setup();
  await core.call("app.state");
  const book = (id: number, title: string, author: string) =>
    file(
      `${id}.epub`,
      epub({
        opfMeta: `<dc:identifier id="id">urn:uuid:${id}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language>`,
      }),
    );
  await core.call("books.import", {
    paths: [
      book(1, "Book 10", "Anne Brontë"),
      book(2, "Book 2", "Charlotte Brontë"),
      book(3, "The Book 3", "Jane Austen"),
      book(4, "Agnes Grey", "Anne Brontë"),
    ],
  });
  await core.idle();
  assert.deepEqual(
    (await core.call("books.list", { sort: "title" })).map((b) => b.title),
    ["Agnes Grey", "Book 2", "The Book 3", "Book 10"],
  );
  assert.deepEqual((await core.call("books.list", { search: "BRONTE anne" })).map((b) => b.title).sort(), ["Agnes Grey", "Book 10"]);
  assert.deepEqual(
    (await core.call("books.list", { sort: "author" })).map((b) => b.authors[0]),
    ["Jane Austen", "Anne Brontë", "Anne Brontë", "Charlotte Brontë"],
  );
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
      tags: ["Romance", "to-read"],
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
  assert.deepEqual(
    b.tags.map((t) => `${t.name} (${t.by})`),
    ["Romance (calibre)", "to-read (calibre)", "Fiction (magpie)"],
    "Calibre's tags come over as they were, and its Romance tag puts the book on the Fiction shelf",
  );
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
  writeFileSync(join(kobo, "bought-on-kobo.kepub.epub"), "x");
  assert.deepEqual(await core.call("devices.books", { device: dev.path }), { ids: [], others: 0 });
  await core.call("send.kobo", { ids: [b.id], device: dev.path });
  await core.idle();
  const sent = join(kobo, "Magpie", "Jane-Austen-Emma.kepub.epub");
  assert.match(strFromU8(unzipSync(readFileSync(sent))["ch1.xhtml"]), /<span class="koboSpan" id="kobo\.1\.1">Chapter 1<\/span>/);
  const d = await core.call("books.get", { id: b.id });
  assert.doesNotMatch(strFromU8(unzipSync(readFileSync(d.file))["ch1.xhtml"]), /koboSpan/);
  assert.deepEqual(readdirSync(join(kobo, "Magpie")), ["Jane-Austen-Emma.kepub.epub"]);
  assert.deepEqual(await core.call("devices.books", { device: dev.path }), { ids: [b.id], others: 0 });
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

function makeCalibre(
  dir: string,
  books: { title: string; authors: string[]; series?: string; index?: number; tags?: string[]; epub: Uint8Array | null }[],
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
    for (const t of b.tags ?? []) {
      db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(t);
      const tid = (db.prepare("SELECT id FROM tags WHERE name = ?").get(t) as { id: number }).id;
      db.prepare("INSERT INTO books_tags_link (book, tag) VALUES (?, ?)").run(id, tid);
    }
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

test("edits are checked, a Kobo must be a connected reader, and a missing file gets a sentence", async () => {
  const { core, file, home } = setup();
  await core.call("app.state");
  await core.call("books.import", { paths: [file("a.epub", epub()), join(home, "Downloads/gone.epub")] });
  await core.idle();
  const [job] = (await core.call("app.state")).jobs;
  assert.match(job.results.find((r) => r.label === "gone.epub")!.message!, /couldn't find this file/);
  const [b] = await core.call("books.list");
  for (const patch of [{ title: " " }, { year: -40000 }, { seriesIndex: 1e308 }, { language: "zz 🙂" }, { authors: [""] }])
    await assert.rejects(core.call("books.edit", { id: b.id, patch }), (e: Error) => !/Copy Diagnostics/.test(e.message));
  await core.call("books.edit", { id: b.id, patch: { year: 1815, seriesIndex: 2.5, language: "pt-BR" } });
  await assert.rejects(core.call("send.kobo", { ids: [b.id], device: join(home, "Downloads") }), /isn't connected/);
});

// Open Library, as the fixture answers it. Keys are URL fragments; the first that matches answers.
const OPEN_LIBRARY = {
  "isbn=9780345535689": {
    docs: [
      {
        key: "/works/OL16489877W",
        title: "The great work of your life",
        author_name: ["Stephen Cope"],
        first_publish_year: 2012,
        publisher: ["Bantam"],
        language: ["eng"],
        isbn: ["0345535685", "9780345535689"],
        subject: ["Vocation", "Hinduism"],
      },
    ],
  },
  "title=Emma&author=Jane+Austen": {
    docs: [
      {
        key: "/works/OL66562W",
        title: "Emma",
        author_name: ["Jane Austen"],
        first_publish_year: 1815,
        publisher: ["Penguin", "Dover"],
        language: ["eng"],
        subject: ["Fiction"],
      },
      { key: "/works/OL1W", title: "Emma's Secret", author_name: ["Someone Else"], first_publish_year: 2001 },
    ],
  },
  "title=Emma&fields": { docs: [{ key: "/works/OL66562W", title: "Emma", author_name: ["Jane Austen"], first_publish_year: 1815 }] },
  "/works/OL66562W.json": {
    description: "Emma Woodhouse, handsome, clever, and rich, meddles in the love lives of her friends.\r\n\r\n----------\r\nContains: [x](y)",
  },
  "/works/OL16489877W.json": { description: { value: "A guide to finding the work you were born to do, through the Bhagavad Gita." } },
};

const withIsbn = () =>
  epub({
    opfMeta:
      '<dc:identifier id="id">urn:isbn:978-0-345-53568-9</dc:identifier><dc:title>The Great Work of Your Life</dc:title><dc:creator>Stephen Cope</dc:creator><dc:language>en</dc:language>',
  });

test("Look Up Details fills what books are missing from Open Library, waits for review, and is one undo", async () => {
  const { core, file } = setup(OPEN_LIBRARY);
  await core.call("app.state");
  await core.call("books.import", { paths: [file("emma.epub", epub()), file("cope.epub", withIsbn())] });
  await core.idle();
  assert.deepEqual(await core.call("books.lookupCount"), { count: 2 });
  const job = await core.call("books.lookup", {});
  await core.idle();
  const done = await core.call("jobs.get", { id: job!.id });
  assert.deepEqual(
    done.results.map((r) => [r.label, r.outcome, r.message]),
    [
      ["Emma", "found", "Found year and description."],
      ["The Great Work of Your Life", "found", "Found year, publisher and description."],
    ],
  );
  const [emma, cope] = await Promise.all((await core.call("books.list", { sort: "title" })).map((b) => core.call("books.get", { id: b.id })));
  assert.equal(emma.state, "review");
  assert.deepEqual(
    emma.report.suggestions.map((s) => [s.field, s.value, s.confidence, s.source]),
    [
      ["year", "1815", 0.9, "Open Library, matched by title and author"],
      [
        "description",
        "Emma Woodhouse, handsome, clever, and rich, meddles in the love lives of her friends.",
        0.9,
        "Open Library, matched by title and author",
      ],
    ],
    "the language is already there, and a publisher is only taken from an exact edition (ISBN)",
  );
  assert.deepEqual(emma.plan.catalog?.subjects, ["Fiction"]);
  assert.equal(emma.plan.catalog?.firstYear, 1815);
  assert.equal(emma.year, undefined, "nothing is written before review");
  assert.deepEqual(
    cope.report.suggestions.map((s) => [s.field, s.value, s.confidence]),
    [
      ["year", "2012", 0.95],
      ["publisher", "Bantam", 0.95],
      ["description", "A guide to finding the work you were born to do, through the Bhagavad Gita.", 0.95],
    ],
  );
  assert.deepEqual(await core.call("books.lookupCount"), { count: 0 }, "looked-up books aren't asked about again");

  // The whole run is one ⌘Z.
  assert.equal((await core.call("app.state")).undo, "Look Up Details");
  await core.call("history.undo");
  assert.equal((await core.call("books.get", { id: emma.id })).report.suggestions.length, 0);
  assert.equal((await core.call("books.get", { id: cope.id })).state, "fixed");
  assert.deepEqual(await core.call("books.lookupCount"), { count: 2 });

  // Again, then accept: the year is written into the book.
  await core.call("books.lookup", { ids: [emma.id] });
  await core.idle();
  const again = await core.call("books.get", { id: emma.id });
  await core.call("books.review", { decisions: [{ id: emma.id, accept: patchFor(again.report.suggestions), dismiss: [] }] });
  const accepted = await core.call("books.get", { id: emma.id });
  assert.equal(accepted.year, 1815);
  assert.equal(accepted.state, "fixed");
  assert.match(strFromU8(unzipSync(readFileSync(accepted.file))["content.opf"]), /<dc:date>1815<\/dc:date>/);
});

test("Look Up Details is careful: the book's own pages win, an unclear match suggests nothing, offline gets a sentence, DRM is skipped", async () => {
  const { core, file } = setup({
    ...OPEN_LIBRARY,
    "title=Nobody": { docs: [{ key: "/works/X", title: "Nobody Knows", author_name: ["A"] }] },
    "title=Offline": null,
  });
  await core.call("app.state");
  const nobody = epub({ opfMeta: '<dc:identifier id="id">urn:uuid:7</dc:identifier><dc:title>Nobody</dc:title><dc:creator>B. Writer</dc:creator>' });
  const offline = epub({ opfMeta: '<dc:identifier id="id">urn:uuid:8</dc:identifier><dc:title>Offline</dc:title><dc:creator>C. Writer</dc:creator>' });
  await core.call("books.import", { paths: [file("unknown.epub", unknownAuthor()), file("nobody.epub", nobody), file("offline.epub", offline)] });
  await core.idle();
  const job = await core.call("books.lookup", {});
  await core.idle();
  const results = (await core.call("jobs.get", { id: job!.id })).results;
  assert.deepEqual(
    results.map((r) => [r.label, r.outcome]),
    [
      ["Emma", "found"],
      ["Nobody", "skipped"],
      ["Offline", "failed"],
    ],
  );
  assert.match(results[1].message!, /no clear match/);
  assert.match(results[2].message!, /couldn't reach Open Library/);
  const [emma] = await core.call("books.list", { search: "Emma" });
  const authors = (await core.call("books.get", { id: emma.id })).report.suggestions.find((s) => s.field === "authors")!;
  assert.equal(authors.source.includes("Open Library"), false, "the title page's Author: line beats an unchecked title-only match");
  assert.deepEqual(await core.call("books.lookupCount"), { count: 1 }, "only the offline one is left to try");
});
