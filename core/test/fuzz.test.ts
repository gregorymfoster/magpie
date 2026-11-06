// Import, fuzzed. People drop whatever they have on Magpie: half-downloaded
// files, books a tool mangled, zips of zips, things that only look like books.
// fast-check takes real books of every kind Magpie reads and damages them
// (flipped and cut bytes; for EPUBs, pages and package files rewritten,
// dropped, renamed or added with hostile names) and imports each through
// core.call, the way the app does. Each must come out one of two ways: added,
// as a book that opens and whose fixers all ran, with its original kept byte
// for byte; or turned away with a sentence saying why. Never a raw exception,
// never a fixer that crashed, never a stray file. The skill verify-import-fuzz
// explains how to read a failure.
//
// FUZZ_RUNS sets how many files (60 here, more nightly); FUZZ_SEED replays one run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createCore } from "../src/index.ts";
import { explain } from "../src/errors.ts";
import { Book, BookError } from "../src/epub.ts";
import { fix, newPlan } from "../src/fix.ts";
import { sniff, toEpub } from "../src/convert/index.ts";
import { readInfo } from "../src/info.ts";
import { nodeHost } from "../../cli/src/node-host.ts";
import { epub, jpeg, page } from "./fixtures.ts";

const RUNS = Number(process.env.FUZZ_RUNS ?? 60);
Error.stackTraceLimit = 40;
const SEED = process.env.FUZZ_SEED ? Number(process.env.FUZZ_SEED) : undefined;
const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "books", name)));

/** An EPUB with most of what real ones carry: a nav, an NCX, a stylesheet, a cover, two chapters with links between them. */
const RICH = (() => {
  const files = unzipSync(
    epub({
      pages: {
        "title.xhtml": page('<h1>Emma</h1><p class="by">Jane Austen</p><img src="cover.jpg" alt="cover"/>'),
        "ch1.xhtml": page('<h2 id="c1">Chapter 1</h2><p>Emma Woodhouse, handsome, clever, and rich.</p><p><a href="ch2.xhtml#c2">On</a></p>'),
        "ch2.xhtml": page('<h2 id="c2">Chapter 2</h2><p style="font-size:9px;margin:0;color:#333">Mr. Weston was a native of Highbury.</p>'),
        "nav.xhtml": page('<nav epub:type="toc"><ol><li><a href="ch1.xhtml">One</a></li><li><a href="ch2.xhtml">Two</a></li></ol></nav>'),
      },
      manifest: '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>',
      extra: {
        "toc.ncx":
          '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap><navPoint id="n1" playOrder="1"><navLabel><text>One</text></navLabel><content src="ch1.xhtml"/></navPoint></navMap></ncx>',
        "style.css": "body { font-family: serif; margin: 0 } .by { font-size: 70% }",
      },
    }),
  );
  return files;
})();

const SEEDS: { name: string; bytes: Uint8Array }[] = [
  { name: "emma.epub", bytes: zipSync(RICH) },
  { name: "pride.mobi", bytes: fixture("pride.mobi") },
  { name: "pride.azw3", bytes: fixture("pride.azw3") },
  { name: "pride.fb2", bytes: fixture("pride.fb2") },
  { name: "pride.pdf", bytes: fixture("pride.pdf") },
  { name: "notes.txt", bytes: strToU8("Title: Notes\nAuthor: Ada Lovelace\n\nChapter 1\n\nThe first part.\n\nChapter 2\n\nThe second part.\n") },
  {
    name: "page.html",
    bytes: strToU8("<!DOCTYPE html><html><head><title>Notes</title></head><body><h1>One</h1><p>Text.</p><h1>Two</h1><p>More.</p></body></html>"),
  },
];

/** Markup that breaks parsers in interesting ways. */
const NASTY = fc.constantFrom(
  "<",
  "</p>",
  "<p>",
  "<![CDATA[",
  "]]>",
  "<!--",
  "&",
  "&#0;",
  "&#xFFFF;",
  "&nbsp;",
  "\u0000",
  "﻿",
  "\uD800",
  '"',
  '<a href="../../../../etc/passwd">x</a>',
  '<img src="missing.png"/>',
  '<item id="x" href="nowhere.xhtml" media-type="application/xhtml+xml"/>',
  '<itemref idref="nope"/>',
  "<dc:title></dc:title>",
  "<dc:creator>" + "A".repeat(5000) + "</dc:creator>",
  '<meta name="cover" content="nope"/>',
  "<svg><script>alert(1)</script></svg>",
  '<?xml version="1.0" encoding="utf-16"?>',
  '<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>',
);

/** Text, damaged: something cut out, or something nasty put in, a few times. */
const damageText = (text: string) =>
  fc
    .array(
      fc.oneof(
        fc.record({ at: fc.double({ min: 0, max: 1, noNaN: true }), cut: fc.nat(200) }),
        fc.record({ at: fc.double({ min: 0, max: 1, noNaN: true }), put: fc.oneof(NASTY, fc.string({ maxLength: 20 })) }),
      ),
      { minLength: 1, maxLength: 4 },
    )
    .map((ops) => {
      let t = text;
      for (const op of ops) {
        const i = Math.floor(op.at * t.length);
        t = "cut" in op ? t.slice(0, i) + t.slice(i + op.cut) : t.slice(0, i) + op.put + t.slice(i);
      }
      return t;
    });

const ENTRY_NAMES = fc.constantFrom(
  "../escape.xhtml",
  "/abs.xhtml",
  "a\\b.xhtml",
  "META-INF/../content.opf",
  "x".repeat(300) + ".xhtml",
  "dir/",
  "ünï cødé.xhtml",
  "CON.xhtml",
  "mimetype",
  "META-INF/encryption.xml",
);

/** An EPUB with one to three of its files damaged, dropped, renamed or joined by a hostile one. */
const DAMAGED_EPUB: fc.Arbitrary<Uint8Array> = fc
  .array(
    fc.oneof(
      fc.record({ kind: fc.constant("text" as const), file: fc.constantFrom(...Object.keys(RICH)), seed: fc.nat() }),
      fc.record({ kind: fc.constant("drop" as const), file: fc.constantFrom(...Object.keys(RICH)) }),
      fc.record({ kind: fc.constant("rename" as const), file: fc.constantFrom(...Object.keys(RICH)), to: ENTRY_NAMES }),
      fc.record({ kind: fc.constant("add" as const), to: ENTRY_NAMES, body: fc.oneof(NASTY, fc.constant("<html/>")) }),
      fc.record({ kind: fc.constant("image" as const), w: fc.nat(70000), h: fc.nat(70000) }),
    ),
    { minLength: 1, maxLength: 3 },
  )
  .chain((ops) =>
    fc.tuple(...ops.map((op) => (op.kind === "text" ? damageText(strFromU8(RICH[op.file], true)) : fc.constant("")))).map((texts) => {
      const files: Record<string, Uint8Array> = { ...RICH };
      ops.forEach((op, i) => {
        if (op.kind === "text" && op.file in files) files[op.file] = strToU8(texts[i]);
        else if (op.kind === "drop") delete files[op.file];
        else if (op.kind === "rename" && op.file in files) {
          files[op.to] = files[op.file];
          delete files[op.file];
        } else if (op.kind === "add") files[op.to] = strToU8(op.body);
        else if (op.kind === "image") files["cover.jpg"] = jpeg(op.w, op.h);
      });
      return zipSync(files);
    }),
  );

/** Any seed, damaged at the byte level: bytes flipped, the end cut off, or junk put in. */
const DAMAGED_BYTES: fc.Arbitrary<{ name: string; bytes: Uint8Array }> = fc
  .record({
    seed: fc.constantFrom(...SEEDS),
    flips: fc.array(fc.record({ at: fc.double({ min: 0, max: 1, noNaN: true }), to: fc.nat(255) }), { maxLength: 8 }),
    cut: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
  })
  .map(({ seed, flips, cut }) => {
    let b = new Uint8Array(seed.bytes);
    for (const f of flips) b[Math.floor(f.at * b.length)] = f.to;
    if (cut !== undefined) b = b.subarray(0, Math.floor(cut * b.length));
    return { name: seed.name, bytes: b };
  });

const FILES = fc.oneof(
  DAMAGED_EPUB.map((bytes) => ({ name: "emma.epub", bytes })),
  DAMAGED_BYTES,
  // A zip of damaged books, for the archive path.
  fc.array(DAMAGED_BYTES, { minLength: 1, maxLength: 3 }).map((xs) => ({
    name: "books.zip",
    bytes: zipSync(Object.fromEntries(xs.map((x, i) => [`in/${i}-${x.name}`, x.bytes]))),
  })),
);

/** What the import path throws for a file, outside the job that turns it into a sentence: for reading a failure. */
async function rawError(bytes: Uint8Array, name: string): Promise<string> {
  try {
    const kind = sniff(bytes, name);
    if (!kind) return "not sniffed as a book";
    const source = await toEpub(bytes, kind, name);
    fix(source, newPlan({ uuid: "00000000-0000-4000-8000-000000000000", modified: "2024-01-01T00:00:00Z" }));
    return "nothing thrown outside the Library";
  } catch (e) {
    return e instanceof BookError ? `BookError ${e.code}` : String((e as Error)?.stack ?? e);
  }
}

test("any damaged file is either added as a book that opens, with every fixer run and its original kept, or turned away with a sentence", async () => {
  const home = mkdtempSync(join(tmpdir(), "magpie-fuzz-"));
  mkdirSync(join(home, "Downloads"));
  const core = createCore(nodeHost({ MAGPIE_HOME: home, MAGPIE_MODEL: "/no-model", MAGPIE_OPENED: join(home, "opened.txt") }));
  await core.call("settings.set", { organize: false });
  let n = 0;
  const unexpected = explain("unexpected");
  try {
    await fc.assert(
      fc.asyncProperty(FILES, async (f) => {
        const path = join(home, "Downloads", `${++n}-${f.name}`);
        writeFileSync(path, f.bytes);
        const started = Date.now();
        const job = await core.call("books.import", { paths: [path] });
        await core.idle();
        const done = await core.call("jobs.get", { id: job.id });
        assert.ok(Date.now() - started < 20_000, `took ${Date.now() - started} ms`);
        assert.equal(done.state, "done");
        for (const r of done.results) {
          if (!["added", "duplicate", "unreadable"].includes(r.outcome))
            assert.fail(`${r.label}: ${r.outcome} ${r.message ?? ""}\n${f.name.endsWith(".zip") ? "" : await rawError(f.bytes, f.name)}`);
          assert.notEqual(
            r.message,
            unexpected,
            `${r.label}: a raw exception (${(await core.call("app.diagnostics")).split("\n").find((l) => /error/i.test(l)) ?? ""})`,
          );
          if (r.outcome === "unreadable") assert.ok(r.message && !/Error|undefined|\[object/.test(r.message), `${r.label}: "${r.message}" isn't a sentence`);
          if (r.outcome !== "added") continue;
          const d = await core.call("books.get", { id: r.bookId! });
          if (process.env.FUZZ_TALLY) for (const e of d.report.errors) appendFileSync(process.env.FUZZ_TALLY, `${e.fixer}: ${e.error}\n`);
          else assert.deepEqual(d.report.errors, [], `${d.title}: a fixer crashed`);
          if (d.state !== "locked") {
            const book = Book.load(new Uint8Array(readFileSync(d.file)));
            assert.ok(book.opfPath, `${d.title}: the fixed book has no package`);
            readInfo(book);
          }
          const original = new Uint8Array(readFileSync(d.original));
          if (!f.name.endsWith(".zip")) assert.ok(Buffer.from(original).equals(Buffer.from(f.bytes)), "the original isn't the file as it came");
          assert.equal(createHash("sha256").update(original).digest("hex"), d.original.match(/([0-9a-f]{64})/)![1]);
        }
      }),
      { numRuns: RUNS, seed: SEED, includeErrorInReport: true },
    );
  } finally {
    await core.close();
  }
});
