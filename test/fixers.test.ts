import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8, unzipSync } from "fflate";
import { fixEpub, Book } from "../src/index.ts";
import { isJunkTitle, unshout } from "../src/fixers/metadata.ts";
import { toXhtml, wellFormednessErrors } from "../src/fixers/xhtml.ts";

const page = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;

function epub(opts: { opfMeta?: string; pages?: Record<string, string>; mimetypeLast?: boolean } = {}) {
  const pages = opts.pages ?? { "title.xhtml": page("<p>Title: Emma</p><p>Author: Jane Austen</p>"), "ch1.xhtml": page("<h2>Chapter 1</h2><p>Hi</p>") };
  const items = Object.keys(pages).map((p, i) => `<item id="p${i}" href="${p}" media-type="application/xhtml+xml"/>`).join("");
  const spine = Object.keys(pages).map((_, i) => `<itemref idref="p${i}"/>`).join("");
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${
    opts.opfMeta ?? '<dc:identifier id="id">urn:uuid:1</dc:identifier><dc:title>Emma</dc:title><dc:creator>Jane Austen</dc:creator><dc:language>en</dc:language>'
  }<meta property="dcterms:modified">2024-01-01T00:00:00Z</meta></metadata><manifest>${items}<item id="cov" href="cover.jpg" media-type="image/jpeg"/></manifest><spine>${spine}</spine></package>`;
  const files: Record<string, Uint8Array> = {
    "META-INF/container.xml": strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    "content.opf": strToU8(opf),
    "cover.jpg": new Uint8Array([0xff, 0xd8, 0xff]),
  };
  for (const [k, v] of Object.entries(pages)) files[k] = strToU8(v);
  const mimetype: [Uint8Array, { level: 0 }] = [strToU8("application/epub+zip"), { level: 0 }];
  return zipSync(opts.mimetypeLast ? { ...files, mimetype } : { mimetype, ...files });
}

test("writes mimetype first and uncompressed", () => {
  const out = fixEpub(epub({ mimetypeLast: true }));
  assert.ok(out.changes.some((c) => c.fixer === "container"));
  assert.equal(Object.keys(unzipSync(out.bytes))[0], "mimetype");
});

test("fills an Unknown author from the title page and says where it came from", () => {
  const out = fixEpub(epub({ opfMeta: '<dc:identifier id="id">urn:uuid:1</dc:identifier><dc:title>Emma</dc:title><dc:creator>Unknown</dc:creator><dc:language>en</dc:language>' }));
  const c = out.changes.find((c) => c.fixer === "metadata")!;
  assert.match(c.message, /Jane Austen/);
  assert.match(c.source!, /Author:/);
  assert.match(Book.load(out.bytes).opf().dc("creator")[0].textContent!, /Jane Austen/);
});

test("declares a cover image named cover", () => {
  const out = fixEpub(epub());
  const opf = Book.load(out.bytes).opf();
  assert.equal(opf.metas().find((m) => m.getAttribute("name") === "cover")?.getAttribute("content"), "cov");
  assert.match(opf.itemById("cov")!.getAttribute("properties") ?? "", /cover-image/);
});

test("repairs entities and unclosed tags into well-formed XHTML", () => {
  const { out } = toXhtml(page("<p>Tom & Jerry&nbsp;<b>bold</p><br>"), true);
  assert.deepEqual(wellFormednessErrors(out), []);
  assert.match(out, /Tom &amp; Jerry/);
});

test("leaves a book alone apart from the cover and missing nav", () => {
  const out = fixEpub(epub());
  assert.deepEqual(out.errors, []);
  assert.deepEqual([...new Set(out.changes.map((c) => c.fixer))].sort(), ["cover", "toc"]);
});

test("title heuristics", () => {
  assert.ok(isJunkTitle("9780316_final(1)"));
  assert.ok(isJunkTitle("ebook-export-2019-03-11"));
  assert.ok(!isJunkTitle("Moby-Dick"));
  assert.ok(!isJunkTitle("Emma"));
  assert.equal(unshout("THE HOUND OF THE BASKERVILLES"), "The Hound of the Baskervilles");
  assert.equal(unshout("L. M. MONTGOMERY"), "L. M. Montgomery");
});
