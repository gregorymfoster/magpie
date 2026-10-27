import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { fix, fixAndAccept, newPlan } from "../src/fix.ts";
import { Book } from "../src/epub.ts";
import { isJunkTitle, unshout } from "../src/identify/rules.ts";
import { toXhtml, wellFormednessErrors } from "../src/fixers/xhtml.ts";

import { epub, jpeg, page } from "./fixtures.ts";
import { imageSize } from "../src/images.ts";

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

const long = (s: string) =>
  `<p>${s} ${"It was a truth universally acknowledged, and the neighbourhood held it so firmly that nobody ever asked. ".repeat(2)}</p>`;
const styled = (body: string, css: string) =>
  epub({
    pages: { "ch1.xhtml": page(body).replace("<title>t</title>", '<title>t</title><link rel="stylesheet" type="text/css" href="style.css"/>') },
    manifest: '<item id="css" href="style.css" media-type="text/css"/>',
    extra: { "style.css": css },
  });
const files = (bytes: Uint8Array) => {
  const z = unzipSync(bytes);
  return (p: string) => new TextDecoder().decode(z[p]);
};

test("layout: publisher styling that overrides the reader's font, size, spacing and dark mode comes off body text; headings keep theirs", () => {
  const css = `/* house style */
body { font-family: "Times New Roman", serif; font-size: 12pt; color: #000; background: #fff; margin: 5%; }
p { line-height: 18px; text-indent: 1.5em; margin: 0; }
.calibre1 { font-size: 0.9em; font-family: Georgia; }
h1 { font-family: "Fancy Display"; font-size: 24px; color: #800000; }
@media amzn-kf8 { p { color: black; } }
@page { margin: 30pt; }`;
  const body = `<h1>Chapter One</h1>${long('<span class="x">One.</span>').replace("<p>", '<p class="calibre1">')}${long("Two.").replace("<p>", '<p class="calibre1">')}${long("Three.").replace("<p>", '<p class="calibre1">')}`;
  const out = fixEpub(styled(body, css));
  const sheet = files(out.bytes)("style.css");
  assert.doesNotMatch(sheet, /Times New Roman|12pt|#000|#fff|18px|margin: 5%|Georgia|0\.9em|30pt/);
  assert.match(sheet, /text-indent: 1\.5em/);
  assert.match(
    sheet,
    /h1 \{\s*font-family: "Fancy Display";\s*font-size: 1\.5em;\s*color: #800000;/,
    "headings keep their face and colour; the pixel size becomes relative",
  );
  assert.ok(out.report.changes.some((c) => c.fixer === "layout" && /dark mode/.test(c.message)));
  assert.deepEqual(out.report.todos, []);
});

test("layout: spacer paragraphs go, blank lines between paragraphs become visible scene breaks, and plain chapter titles become headings", () => {
  const body = `<p class="chapter">Chapter 2</p><p>&#160;</p>${long("One.")}${long("Two.")}<p>&#160;</p><p>&#160;</p>${long("Three.")}<p class="center">* * *</p>${long("&#160;&#160;&#160;Four.")}<p><br/></p>`;
  const out = fixEpub(styled(body, "p { margin: 0 }"));
  const read = files(out.bytes);
  const ch = read("ch1.xhtml");
  assert.match(ch, /<h2 class="chapter">Chapter 2<\/h2>/);
  assert.equal(ch.match(/<hr class="scene-break"\/>/g)?.length, 1);
  assert.match(ch, /<p class="center">\* \* \*<\/p>/, "a break the publisher drew is left as it is");
  assert.doesNotMatch(ch, /&#160;| /);
  assert.match(ch, /<link rel="stylesheet" type="text\/css" href="magpie.css"\/>/);
  assert.match(read("content.opf"), /href="magpie.css" media-type="text\/css"/);
  assert.match(read("magpie.css"), /img \{ max-width: 100%/);
  const said = out.report.changes.filter((c) => c.fixer === "layout").map((c) => c.message);
  assert.ok(
    said.some((m) => /Removed 3 empty spacer paragraphs/.test(m)),
    said.join("\n"),
  );
  assert.ok(said.some((m) => /Turned 1 scene break made of blank lines into a visible break/.test(m)));
  assert.ok(said.some((m) => /Set 1 chapter title as a real heading/.test(m)));
  assert.ok(said.some((m) => /hard-space indents of 1 paragraph with real indents/.test(m)));
});

test("layout: a book that spaces every paragraph with an empty one loses the spacers, not gains scene breaks", () => {
  const body = ["One.", "Two.", "Three.", "Four.", "Five.", "Six."].map(long).join("<p>&#160;</p>");
  const ch = files(fixEpub(styled(body, "p { margin: 0 }")).bytes)("ch1.xhtml");
  assert.doesNotMatch(ch, /scene-break|&#160;/);
  assert.equal(ch.match(/<p>/g)?.length, 6);
});

test("layout: Keep the book's own styling leaves the publisher's design alone", () => {
  const book = styled(`<p class="chapter">Chapter 2</p>${long("One.")}${long("Two.")}${long("Three.")}`, "body { font-family: Garamond; color: #000 }");
  const out = fix(book, { ...newPlan(stamp), keepStyle: true });
  assert.ok(!out.report.changes.some((c) => c.fixer === "layout"));
  assert.match(files(out.bytes)("style.css"), /Garamond/);
});

test("checks: several chapters that open with a bold line Magpie isn't sure is a title become one to-do", () => {
  const ch = (t: string) => page(`<p><b>${t}</b></p>${long("One.")}${long("Two.")}${long("Three.")}`);
  const out = fixEpub(epub({ pages: { "a.xhtml": ch("The Ball"), "b.xhtml": ch("A Letter"), "c.xhtml": ch("Highbury") } }));
  assert.deepEqual(
    out.report.todos?.map((t) => t.id),
    ["unsure-titles"],
  );
  assert.match(out.report.todos![0].message, /^3 chapters start with a bold line/);
});
