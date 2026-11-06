// File names, for any title and author at all. Every name Magpie writes comes
// from core/src/naming.ts, and books' details come from anywhere: a store's
// package, Calibre, Open Library, a person typing. fast-check throws every
// kind of text at it (any Unicode, lone surrogates, control characters, dots,
// slashes, very long names in any script) and checks that what comes out is
// a name every place Magpie writes can hold: the Library on APFS, a Kobo's
// FAT32 card, a Mail attachment. The skill verify-naming explains a failure.
//
// NAMING_RUNS sets how many (500 here, more nightly).

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { bookPath, deviceName, slug, unique } from "../src/naming.ts";

const RUNS = Number(process.env.NAMING_RUNS ?? 500);

/** Any text a book's details could hold, weighted toward what breaks names. */
const TEXT = fc.oneof(
  fc.string({ unit: "binary", maxLength: 300 }),
  fc.string({ unit: "grapheme", maxLength: 300 }),
  fc.string({ unit: fc.constantFrom("𠀀", "𝔄", "한", "ü", "ﬁ", "-", " ", ".", "/", ":", "\u0000", "​", "é", "🙂", "Ω", "ß"), maxLength: 200 }),
  // Long runs of one letter after a short start: CJK, astral letters (two UTF-16 units each), Hangul, Latin.
  fc
    .record({ start: fc.string({ maxLength: 3 }), letter: fc.constantFrom("𠀀", "𝔄", "村", "한", "a"), n: fc.integer({ min: 1, max: 150 }) })
    .map((r) => r.start + r.letter.repeat(r.n)),
  fc.constantFrom("", ".", "..", "...", "-", " ", "/", "CON", "Ursula K. Le Guin", "Brontë", "Пушкин", "村上春樹", "D'Arcy & Co."),
);

/** True when the text has no half of a surrogate pair on its own, so it can be a file name at all. */
const wellFormed = (s: string) => !/[\uD800-\uDFFF]/u.test(s);
const bytes = (s: string) => new TextEncoder().encode(s).length;
/** What a name may be made of: letters and digits in runs joined by single hyphens. No lone surrogates, so it's valid text. */
const WORDS = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
/** A file name's limit in bytes of UTF-8 (APFS) and in UTF-16 units (FAT32 long names). */
const fits = (name: string) => bytes(name) <= 255 && name.length <= 255;

test("a slug is letters and digits joined by hyphens, never empty, short enough, and valid text", () => {
  fc.assert(
    fc.property(TEXT, (s) => {
      const out = slug(s, "Untitled");
      assert.match(out, WORDS);
      assert.ok(wellFormed(out), "a lone surrogate");
      assert.ok(bytes(out) <= 240, `${bytes(out)} bytes`);
    }),
    { numRuns: RUNS },
  );
});

test("a book's place in books/ and the name it gets on a device or in Mail fit every disk and have no spaces", () => {
  fc.assert(
    fc.property(fc.array(TEXT, { maxLength: 3 }), TEXT, fc.constantFrom("epub", "azw3", "kepub.epub", "mobi"), (authors, title, ext) => {
      const path = bookPath(authors, title, ext);
      const [dir, file, ...rest] = path.split("/");
      assert.equal(rest.length, 0, path);
      assert.match(dir, WORDS);
      assert.ok(file.endsWith(`.${ext}`) && WORDS.test(file.slice(0, -ext.length - 1)), file);
      assert.ok(fits(dir) && fits(file), `${bytes(file)} bytes`);
      const device = deviceName(authors, title, ext);
      assert.ok(!/[\s/\\:*?"<>|]/.test(device) && wellFormed(device), device);
      assert.ok(fits(device), `${device}: ${bytes(device)} bytes, ${device.length} units`);
    }),
    { numRuns: RUNS },
  );
});

test("unique never returns a name that's taken, keeps the folder and ending, and fits", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(TEXT, { maxLength: 2 }), TEXT, fc.nat(30), async (authors, title, n) => {
      const want = bookPath(authors, title, "kepub.epub");
      const taken = new Set([want, ...Array.from({ length: n }, (_, i) => want.replace(/\.kepub\.epub$/, `-${i + 2}.kepub.epub`))]);
      const got = await unique(want, async (p) => taken.has(p));
      assert.ok(!taken.has(got));
      assert.equal(got.split("/")[0], want.split("/")[0]);
      assert.ok(got.endsWith(".kepub.epub"), got);
      assert.ok(fits(got.split("/")[1]), got);
    }),
    { numRuns: RUNS },
  );
});
