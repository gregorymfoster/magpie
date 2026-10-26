// Tiny EPUBs built in memory, so a test states exactly what's in its book.

import { zipSync, strToU8 } from "fflate";

export const page = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;

export function epub(opts: { opfMeta?: string; pages?: Record<string, string>; mimetypeLast?: boolean; extra?: Record<string, string> } = {}) {
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
  }<meta property="dcterms:modified">2024-01-01T00:00:00Z</meta></metadata><manifest>${items}<item id="cov" href="cover.jpg" media-type="image/jpeg"/></manifest><spine>${spine}</spine></package>`;
  const files: Record<string, Uint8Array> = {
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "content.opf": strToU8(opf),
    "cover.jpg": new Uint8Array([0xff, 0xd8, 0xff]),
  };
  for (const [k, v] of Object.entries({ ...pages, ...opts.extra })) files[k] = strToU8(v);
  const mimetype: [Uint8Array, { level: 0 }] = [strToU8("application/epub+zip"), { level: 0 }];
  return zipSync(opts.mimetypeLast ? { ...files, mimetype } : { mimetype, ...files });
}
