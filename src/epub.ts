// The in-memory EPUB that every fixer works on: a map of zip paths to bytes,
// plus a few helpers for paths and the package document (OPF).
// Everything here runs the same in a browser tab and in Node.

import { unzipSync, zipSync, strToU8, type Zippable } from "fflate";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

export const OPF_NS = "http://www.idpf.org/2007/opf";
export const DC_NS = "http://purl.org/dc/elements/1.1/";
export const CONTAINER_PATH = "META-INF/container.xml";

export interface ZipEntryInfo {
  name: string;
  compression: number; // 0 = stored, 8 = deflate
}

export class Book {
  files = new Map<string, Uint8Array>();
  /** Entries in the order they appeared in the original zip. */
  entries: ZipEntryInfo[] = [];
  opfPath: string | null = null;

  static load(bytes: Uint8Array): Book {
    const book = new Book();
    const raw = unzipSync(bytes, {
      filter: (f) => {
        book.entries.push({ name: f.name, compression: f.compression });
        return true;
      },
    });
    for (const e of book.entries) {
      if (e.name.endsWith("/")) continue; // directory entries
      const name = e.name.replace(/\\/g, "/");
      book.files.set(name, raw[e.name]);
    }
    book.opfPath = book.findOpfPath();
    return book;
  }

  /** Write a valid OCF zip: mimetype first and stored, everything else deflated. */
  save(): Uint8Array {
    const z: Zippable = { mimetype: [strToU8("application/epub+zip"), { level: 0 }] };
    for (const [name, data] of this.files) {
      if (name === "mimetype") continue;
      z[name] = [data, { level: /\.(jpe?g|png|gif|webp|woff2?)$/i.test(name) ? 0 : 6 }];
    }
    return zipSync(z);
  }

  has(path: string) {
    return this.files.has(path);
  }

  text(path: string): string {
    const b = this.files.get(path);
    if (!b) throw new Error(`missing ${path}`);
    return decodeUtf8(b);
  }

  setText(path: string, s: string) {
    this.files.set(path, strToU8(s));
  }

  /** Rootfile from container.xml if it exists and points at a real file. */
  findOpfPath(): string | null {
    if (this.has(CONTAINER_PATH)) {
      const m = this.text(CONTAINER_PATH).match(/full-path\s*=\s*["']([^"']+)["']/);
      if (m && this.has(decodePath(m[1]))) return decodePath(m[1]);
    }
    return null;
  }

  opfDir(): string {
    return this.opfPath ? dirname(this.opfPath) : "";
  }

  /** Resolve an href found in the OPF to a zip path. */
  resolve(href: string, from = this.opfPath ?? ""): string {
    return joinPath(dirname(from), decodePath(href.split("#")[0]));
  }

  opf(): OpfDoc {
    if (!this.opfPath) throw new Error("no package document");
    return new OpfDoc(this, this.opfPath);
  }
}

/** A parsed package document. Call save() after changing it. */
export class OpfDoc {
  doc: Document;
  book: Book;
  path: string;
  constructor(book: Book, path: string) {
    this.book = book;
    this.path = path;
    this.doc = new DOMParser().parseFromString(book.text(path), "application/xml") as unknown as Document;
  }
  get pkg(): Element {
    return this.doc.documentElement;
  }
  get version(): string {
    return this.pkg.getAttribute("version") ?? "2.0";
  }
  get epub3(): boolean {
    return this.version.startsWith("3");
  }
  section(name: "metadata" | "manifest" | "spine"): Element {
    let el = byLocal(this.pkg, name)[0];
    if (!el) {
      el = this.doc.createElementNS(OPF_NS, name);
      this.pkg.appendChild(el);
    }
    return el;
  }
  items(): Element[] {
    return byLocal(this.section("manifest"), "item");
  }
  itemrefs(): Element[] {
    return byLocal(this.section("spine"), "itemref");
  }
  itemById(id: string): Element | undefined {
    return this.items().find((i) => i.getAttribute("id") === id);
  }
  itemPath(item: Element): string {
    return this.book.resolve(item.getAttribute("href") ?? "");
  }
  dc(name: string): Element[] {
    return byLocal(this.section("metadata"), name).filter((e) => e.namespaceURI === DC_NS);
  }
  metas(): Element[] {
    return byLocal(this.section("metadata"), "meta");
  }
  addDc(name: string, value: string, attrs: Record<string, string> = {}): Element {
    const el = this.doc.createElementNS(DC_NS, `dc:${name}`);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.appendChild(this.doc.createTextNode(value));
    this.section("metadata").appendChild(el);
    return el;
  }
  addMeta(attrs: Record<string, string>, text?: string): Element {
    const el = this.doc.createElementNS(OPF_NS, "meta");
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.appendChild(this.doc.createTextNode(text));
    this.section("metadata").appendChild(el);
    return el;
  }
  uniqueId(prefix: string): string {
    const taken = new Set(this.items().map((i) => i.getAttribute("id")));
    for (const e of this.doc.getElementsByTagName("*") as unknown as Element[]) taken.add(e.getAttribute("id"));
    let id = prefix.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^([^A-Za-z_])/, "_$1");
    for (let n = 2; taken.has(id); n++) id = `${prefix}-${n}`;
    return id;
  }
  save() {
    this.book.setText(this.path, new XMLSerializer().serializeToString(this.doc as never));
  }
}

export function byLocal(root: Element | Document, name: string): Element[] {
  const out: Element[] = [];
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) if (all[i].localName === name) out.push(all[i]);
  return out;
}

export function textOf(el: Element | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
const cp1252 = new TextDecoder("windows-1252");

/** UTF-8 if the bytes are valid UTF-8, otherwise Windows-1252 (what old Word exports really are). */
export function decodeUtf8(b: Uint8Array): string {
  try {
    return utf8.decode(b).replace(/^﻿/, "");
  } catch {
    return cp1252.decode(b);
  }
}

export function isValidUtf8(b: Uint8Array): boolean {
  try {
    utf8.decode(b);
    return true;
  } catch {
    return false;
  }
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export function joinPath(dir: string, rel: string): string {
  const parts = (dir ? dir + "/" + rel : rel).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

/** Relative href from one zip path to another, percent-encoded per segment. */
export function relativeHref(from: string, to: string): string {
  const a = dirname(from).split("/").filter(Boolean);
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].map(encodeURIComponent).join("/");
}

export function decodePath(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

export const MEDIA_TYPES: Record<string, string> = {
  xhtml: "application/xhtml+xml",
  html: "application/xhtml+xml",
  htm: "application/xhtml+xml",
  css: "text/css",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ncx: "application/x-dtbncx+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  js: "application/javascript",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  smil: "application/smil+xml",
  xpgt: "application/adobe-page-template+xml",
};

export function extOf(p: string): string {
  return (p.match(/\.([^./]+)$/)?.[1] ?? "").toLowerCase();
}
