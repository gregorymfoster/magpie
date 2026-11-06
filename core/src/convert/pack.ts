// Every converter ends here: chapters of HTML, the pictures and styles they
// use, the book's details and its contents, packed as a plain EPUB 3. The
// fixers then clean it exactly as they clean a book that came as an EPUB, so a
// converted book gets the same layout, cover and checks as any other.

import { zipSync, strToU8, type Zippable } from "fflate";
import { toXhtml } from "../fixers/xhtml.ts";
import { zipTime } from "../epub.ts";

export interface Draft {
  title: string;
  authors: string[];
  language?: string;
  publisher?: string;
  description?: string;
  isbn?: string;
  /** Any date the source gives; the year is read out of it later. */
  date?: string;
  subjects?: string[];
  /** Pages in reading order. `html` may be tag soup; it's written out as XHTML. */
  chapters: { name: string; html: string }[];
  /** Pictures, styles and fonts, by their path in the book (relative to the package). */
  resources: { path: string; bytes: Uint8Array }[];
  /** Path of the resource that is the cover. */
  cover?: string;
  toc?: TocEntry[];
  /** Right-to-left books (Japanese, Arabic) turn pages the other way. */
  rtl?: boolean;
}

export interface TocEntry {
  label: string;
  /** chapter name, optionally with #id */
  href: string;
  children?: TocEntry[];
}

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
  css: "text/css",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The picture type from its first bytes, for resources that come without a name. */
export function imageExt(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57) return "webp";
  return null;
}

/** A whole page from a fragment of body HTML. */
export const pageOf = (title: string, body: string, head = "") => `<html><head><title>${esc(title)}</title>${head}</head><body>${body}</body></html>`;

export function pack(d: Draft): Uint8Array {
  const files: Zippable = { mimetype: [strToU8("application/epub+zip"), { level: 0 }] };
  files["META-INF/container.xml"] = strToU8(
    '<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n',
  );
  const items: string[] = [];
  const spine: string[] = [];
  d.chapters.forEach((c, i) => {
    files[`OEBPS/${c.name}`] = strToU8(toXhtml(c.html, true).out);
    items.push(`<item id="t${i + 1}" href="${esc(c.name)}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="t${i + 1}"/>`);
  });
  d.resources.forEach((r, i) => {
    const type = TYPES[r.path.split(".").pop()!.toLowerCase()];
    if (!type) return;
    files[`OEBPS/${r.path}`] = [r.bytes, { level: /^image\/(jpeg|png|gif|webp)$/.test(type) ? 0 : 6 }];
    const cover = r.path === d.cover;
    items.push(`<item id="${cover ? "cover-image" : `r${i + 1}`}" href="${esc(r.path)}" media-type="${type}"${cover ? ' properties="cover-image"' : ""}/>`);
  });
  if (d.toc?.length) {
    const list = (es: TocEntry[]): string =>
      `<ol>${es.map((e) => `<li><a href="${esc(e.href)}">${esc(e.label)}</a>${e.children?.length ? list(e.children) : ""}</li>`).join("")}</ol>`;
    files["OEBPS/nav.xhtml"] = strToU8(
      `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1>${list(d.toc)}</nav></body></html>\n`,
    );
    items.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  }
  const meta = [
    // Without an ISBN the metadata fixer adds a uuid made from the original's hash.
    d.isbn && `<dc:identifier id="bookid">urn:isbn:${esc(d.isbn)}</dc:identifier>`,
    `<dc:title>${esc(d.title)}</dc:title>`,
    ...d.authors.map((a) => `<dc:creator>${esc(a)}</dc:creator>`),
    d.language && `<dc:language>${esc(d.language)}</dc:language>`,
    d.publisher && `<dc:publisher>${esc(d.publisher)}</dc:publisher>`,
    d.date && `<dc:date>${esc(d.date)}</dc:date>`,
    d.description && `<dc:description>${esc(d.description)}</dc:description>`,
    ...(d.subjects ?? []).map((s) => `<dc:subject>${esc(s)}</dc:subject>`),
    d.cover && '<meta name="cover" content="cover-image"/>',
  ].filter(Boolean);
  files["OEBPS/content.opf"] = strToU8(
    `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${meta.join("")}</metadata><manifest>${items.join("")}</manifest><spine${d.rtl ? ' page-progression-direction="rtl"' : ""}>${spine.join("")}</spine></package>\n`,
  );
  // Fixed bytes for the same input: no timestamps in the zip.
  return zipSync(files, { mtime: zipTime() });
}
