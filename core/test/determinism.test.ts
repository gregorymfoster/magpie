// A book is its original plus a FixPlan (ADR 0002): the file in books/ is
// rebuilt from those two whenever anything changes, a power cut is repaired
// by building it again (ADR 0008), and a device copy is cached by the file's
// hash. All of that rests on one property: the same original, plan and cover
// always give the same bytes and the same report, whenever and wherever the
// build runs. fast-check makes up plans (details a person accepted or typed,
// suggestions turned down, a lookup's finds, a chosen cover, kept styling)
// for a set of books, and builds each twice at different times and in
// different time zones. The same goes for turning a Kindle, FictionBook or
// text file into an EPUB, which is kept in converted/ by version.
//
// DETERMINISM_RUNS sets how many plans per book (20 here, more nightly).

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { fix, newPlan, type FixPlan } from "../src/fix.ts";
import { toEpub, sniff } from "../src/convert/index.ts";
import { build } from "../src/send/formats.ts";
import { epub, jpeg, page } from "./fixtures.ts";

const RUNS = Number(process.env.DETERMINISM_RUNS ?? 20);
const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "books", name)));

function coverless() {
  const b = unzipSync(epub());
  delete b["cover.jpg"];
  b["content.opf"] = new TextEncoder().encode(strFromU8(b["content.opf"]).replace(/<item id="cov"[^>]*\/>/, ""));
  return zipSync(b);
}

const BOOKS: Record<string, Uint8Array> = {
  plain: epub(),
  coverless: coverless(),
  unknown: epub({
    opfMeta: '<dc:identifier id="id">urn:uuid:2</dc:identifier><dc:title>Untitled</dc:title><dc:creator>Unknown</dc:creator>',
    pages: { "title.xhtml": page("<p>Title: Persuasion</p><p>Author: Jane Austen</p>"), "ch1.xhtml": page('<p style="font-size:9px;margin:0">Hi</p>') },
  }),
};

/** Two moments a build can run at: a different day, hour, second and time zone each. */
const MOMENTS = [
  { now: Date.UTC(2026, 0, 1, 0, 0, 0), tz: "UTC" },
  { now: Date.UTC(2031, 6, 15, 13, 37, 41), tz: "Pacific/Auckland" },
];

function at<T>(moment: (typeof MOMENTS)[number], run: () => T): T {
  const tz = process.env.TZ;
  process.env.TZ = moment.tz;
  mock.timers.enable({ apis: ["Date"], now: moment.now });
  try {
    return run();
  } finally {
    mock.timers.reset();
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
}

async function atAsync<T>(moment: (typeof MOMENTS)[number], run: () => Promise<T>): Promise<T> {
  const tz = process.env.TZ;
  process.env.TZ = moment.tz;
  mock.timers.enable({ apis: ["Date"], now: moment.now });
  try {
    return await run();
  } finally {
    mock.timers.reset();
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
}

const COVER = { bytes: jpeg(1400, 2100), mediaType: "image/jpeg" };
const FIELDS = ["title", "authors", "year", "publisher", "language", "description", "cover"] as const;

const PLANS: fc.Arbitrary<{ plan: FixPlan; cover: boolean }> = fc
  .record({
    title: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
    authors: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }), { nil: undefined }),
    year: fc.option(fc.integer({ min: 1000, max: 2100 }), { nil: undefined }),
    series: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
    seriesIndex: fc.option(fc.integer({ min: 1, max: 40 }), { nil: undefined }),
    description: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
    keepStyle: fc.boolean(),
    dismissed: fc.subarray([...FIELDS]),
    found: fc.array(
      fc.record({
        field: fc.constantFrom(...FIELDS.filter((f) => f !== "cover")),
        value: fc.string({ minLength: 1, maxLength: 30 }),
        confidence: fc.double({ min: 0, max: 1, noNaN: true }),
      }),
      { maxLength: 3 },
    ),
    cover: fc.boolean(),
    uuid: fc.uuid(),
  })
  .map((r) => {
    const info = Object.fromEntries(
      Object.entries({ title: r.title, authors: r.authors, year: r.year, series: r.series, seriesIndex: r.seriesIndex, description: r.description }).filter(
        ([, v]) => v !== undefined,
      ),
    );
    const plan: FixPlan = { ...newPlan({ uuid: r.uuid, modified: "2024-05-06T07:08:09Z" }, info) };
    if (r.keepStyle) plan.keepStyle = true;
    if (r.dismissed.length) plan.dismissed = r.dismissed;
    if (r.found.length) plan.found = r.found.map((f) => ({ ...f, current: "", source: "Open Library", from: "catalog" as const }));
    if (r.cover) plan.cover = { file: "covers/chosen/x.jpg", from: "you" };
    return { plan, cover: r.cover };
  });

for (const [name, original] of Object.entries(BOOKS))
  test(`fixing the ${name} book gives the same bytes and report whenever and wherever it runs`, () => {
    fc.assert(
      fc.property(PLANS, ({ plan, cover }) => {
        const [a, b] = MOMENTS.map((m) => at(m, () => fix(original, plan, cover ? { cover: COVER } : {})));
        assert.deepEqual(a.report, b.report);
        assert.ok(Buffer.from(a.bytes).equals(Buffer.from(b.bytes)), "the book's bytes differ between two builds");
      }),
      { numRuns: RUNS },
    );
  });

for (const file of ["pride.mobi", "pride.azw3", "pride-combo.mobi", "pride.fb2"])
  test(`turning ${file} into an EPUB, and fixing that, gives the same bytes whenever and wherever it runs`, async () => {
    const bytes = fixture(file);
    const a = await atAsync(MOMENTS[0], () => toEpub(bytes, sniff(bytes, file)!, file));
    const b = await atAsync(MOMENTS[1], () => toEpub(bytes, sniff(bytes, file)!, file));
    assert.ok(Buffer.from(a).equals(Buffer.from(b)), "the converted EPUB differs between two runs");
    const plan = newPlan({ uuid: "00000000-0000-4000-8000-000000000001", modified: "2024-05-06T07:08:09Z" });
    const [x, y] = MOMENTS.map((m) => at(m, () => fix(a, plan)));
    assert.ok(Buffer.from(x.bytes).equals(Buffer.from(y.bytes)), "the fixed book differs between two builds");
  });

test("a device copy (Kobo, Kindle, Apple Books) gives the same bytes whenever and wherever it's made", () => {
  const book = fix(BOOKS.plain, newPlan({ uuid: "00000000-0000-4000-8000-000000000002", modified: "2024-05-06T07:08:09Z" })).bytes;
  for (const format of ["kepub", "kindle", "apple"] as const) {
    const [a, b] = MOMENTS.map((m) => at(m, () => build(format, book)));
    assert.ok(Buffer.from(a).equals(Buffer.from(b)), `the ${format} copy differs between two builds`);
  }
});
