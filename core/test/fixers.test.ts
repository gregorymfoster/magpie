import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { fix, fixAndAccept, newPlan } from "../src/fix.ts";
import { Book } from "../src/epub.ts";
import { isJunkTitle, unshout } from "../src/identify/rules.ts";
import { toXhtml, wellFormednessErrors } from "../src/fixers/xhtml.ts";

import { epub, jpeg, page } from "./fixtures.ts";
import { imageSize } from "../src/checks.ts";

test("writes mimetype first and uncompressed", () => {
  const out = fixEpub(epub({ mimetypeLast: true }));
  assert.ok(out.report.changes.some((c) => c.fixer === "container"));
  assert.equal(Object.keys(unzipSync(out.bytes))[0], "mimetype");
});

const stamp = new Book().stamp;
const fixEpub = (b: Uint8Array) => fix(b, newPlan(stamp));

test("suggests an author for an Unknown one, says where it came from, and writes it only once accepted", () => {
  const unknown = epub({
    opfMeta: '<dc:identifier id="id">urn:uuid:1</dc:identifier><dc:title>Emma</dc:title><dc:creator>Unknown</dc:creator><dc:language>en</dc:language>',
  });
  const s = fixEpub(unknown).report.suggestions;
  assert.deepEqual(
    s.map((x) => [x.field, x.current, x.value]),
    [["authors", "Unknown", "Jane Austen"]],
  );
  assert.match(s[0].source, /Author:/);
  assert.equal(fixEpub(unknown).info.authors[0], "Unknown");
  assert.deepEqual(fixAndAccept(unknown).info.authors, ["Jane Austen"]);
});

test("strips HTML that leaked into the title and author, so readers don't show the tags", () => {
  const out = fixEpub(
    epub({
      opfMeta:
        '<dc:identifier id="id">urn:uuid:1</dc:identifier><dc:title>&lt;i&gt;Emma&lt;/i&gt;</dc:title><dc:creator>&lt;b&gt;Jane Austen&lt;/b&gt;</dc:creator><dc:language>en</dc:language>',
    }),
  );
  assert.equal(out.info.title, "Emma");
  assert.deepEqual(out.info.authors, ["Jane Austen"]);
  assert.ok(out.report.changes.some((c) => c.fixer === "metadata" && /HTML/.test(c.message)));
  assert.equal(Book.load(out.bytes).opf().dc("title")[0].textContent, "Emma");
});

test("the same original and plan always give the same bytes", () => {
  const b = epub({ mimetypeLast: true });
  assert.deepEqual(fixEpub(b).bytes, fixEpub(b).bytes);
});

test("fills an Unknown author from the title page when accepted", () => {
  const out = fixAndAccept(
    epub({
      opfMeta: '<dc:identifier id="id">urn:uuid:1</dc:identifier><dc:title>Emma</dc:title><dc:creator>Unknown</dc:creator><dc:language>en</dc:language>',
    }),
  );
  const c = out.report.changes.find((c) => c.fixer === "metadata")!;
  assert.match(c.message, /Jane Austen/);
  assert.match(c.source!, /Author:/);
  assert.match(Book.load(out.bytes).opf().dc("creator")[0].textContent!, /Jane Austen/);
});

test("declares a cover image named cover", () => {
  const out = fixEpub(epub());
  const opf = Book.load(out.bytes).opf();
  assert.equal(
    opf
      .metas()
      .find((m) => m.getAttribute("name") === "cover")
      ?.getAttribute("content"),
    "cov",
  );
  assert.match(opf.itemById("cov")!.getAttribute("properties") ?? "", /cover-image/);
});

test("repairs entities and unclosed tags into well-formed XHTML", () => {
  const { out } = toXhtml(page("<p>Tom & Jerry&nbsp;<b>bold</p><br>"), true);
  assert.deepEqual(wellFormednessErrors(out), []);
  assert.match(out, /Tom &amp; Jerry/);
});

test("leaves a book alone apart from the cover and missing nav", () => {
  const out = fixEpub(epub());
  assert.deepEqual(out.report.errors, []);
  assert.deepEqual([...new Set(out.report.changes.map((c) => c.fixer))].sort(), ["cover", "toc"]);
});

test("title heuristics", () => {
  assert.ok(isJunkTitle("9780316_final(1)"));
  assert.ok(isJunkTitle("ebook-export-2019-03-11"));
  assert.ok(!isJunkTitle("Moby-Dick"));
  assert.ok(!isJunkTitle("Emma"));
  assert.equal(unshout("THE HOUND OF THE BASKERVILLES"), "The Hound of the Baskervilles");
  assert.equal(unshout("L. M. MONTGOMERY"), "L. M. Montgomery");
});

test("reads an image's size from its header: JPEG, PNG, GIF and WebP", () => {
  const png = new Uint8Array(32);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x06, 0x40, 0, 0, 0x09, 0x60]);
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x2c, 0x01, 0xc2, 0x01, 0, 0]);
  const webp = new Uint8Array(32);
  webp.set(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8X"));
  webp.set([0, 0, 0, 0, 0, 0, 0, 0, 0x3f, 0x06, 0, 0x5f, 0x09, 0], 16);
  assert.deepEqual(imageSize(jpeg(1600, 2400)), { w: 1600, h: 2400 });
  assert.deepEqual(imageSize(png), { w: 1600, h: 2400 });
  assert.deepEqual(imageSize(gif), { w: 300, h: 450 });
  assert.deepEqual(imageSize(webp), { w: 1600, h: 2400 });
  assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
});
