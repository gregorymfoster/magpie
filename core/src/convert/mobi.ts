// Kindle books that aren't EPUB: MOBI (Mobipocket, also .prc and .azw) and
// KF8 (.azw3, and the second half of a "combo" .mobi). Both are a Palm
// database: a header, then records. Record 0 holds the book's details; the
// text records hold compressed HTML; the rest are pictures, fonts and indexes.
//
// MOBI is one long HTML file cut into chapters at <mbp:pagebreak/>, with
// links given as byte offsets (filepos=). KF8 keeps proper XHTML files, split
// into skeletons and fragments, with links of the form kindle:pos:fid:…:off:….
// Both become an EPUB here. A book whose text is encrypted is locked by the
// store: Magpie reads only its unencrypted details and never its text.

import { unzlibSync } from "fflate";
import { BookError } from "../epub.ts";
import { imageExt, pageOf, type Draft, type TocEntry } from "./pack.ts";

const u8 = (b: Uint8Array, o: number) => b[o];
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
const latin1 = new TextDecoder("latin1");

/** BOOKMOBI (a Kindle book) or TEXtREAd (a plain PalmDOC). */
export function isMobi(b: Uint8Array): boolean {
  if (b.length < 78) return false;
  const kind = ascii(b, 60, 8);
  return kind === "BOOKMOBI" || kind === "TEXtREAd";
}

interface Exth {
  authors: string[];
  publisher?: string;
  description?: string;
  isbn?: string;
  subjects: string[];
  date?: string;
  title?: string;
  language?: string;
  asin?: string;
  cover?: number;
  boundary?: number;
  fixedLayout?: boolean;
  rtl?: boolean;
}

interface Header {
  /** Absolute index of this header's record 0. */
  start: number;
  compression: number;
  textRecords: number;
  encryption: number;
  encoding: number;
  version: number;
  title: string;
  resourceStart: number;
  huff: number;
  huffCount: number;
  extraFlags: number;
  ncx: number;
  fdst: number;
  frag: number;
  skel: number;
  exth: Exth;
  locale: number;
}

class Pdb {
  bytes: Uint8Array;
  offsets: number[];
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    const n = u16(bytes, 76);
    this.offsets = [];
    for (let i = 0; i < n; i++) this.offsets.push(u32(bytes, 78 + i * 8));
    if (!n || this.offsets.some((o, i) => o > bytes.length || (i && o < this.offsets[i - 1]))) throw new BookError("not-a-book");
  }
  get count() {
    return this.offsets.length;
  }
  record(i: number): Uint8Array {
    if (i < 0 || i >= this.offsets.length) return new Uint8Array();
    return this.bytes.subarray(this.offsets[i], i + 1 < this.offsets.length ? this.offsets[i + 1] : this.bytes.length);
  }
}

function readHeader(pdb: Pdb, start: number): Header {
  const r = pdb.record(start);
  if (r.length < 16) throw new BookError("not-a-book");
  const h: Header = {
    start,
    compression: u16(r, 0),
    textRecords: u16(r, 8),
    encryption: u16(r, 12),
    encoding: 1252,
    version: 0,
    title: "",
    resourceStart: 0xffffffff,
    huff: 0xffffffff,
    huffCount: 0,
    extraFlags: 0,
    ncx: 0xffffffff,
    fdst: 0xffffffff,
    frag: 0xffffffff,
    skel: 0xffffffff,
    exth: { authors: [], subjects: [] },
    locale: 0,
  };
  if (r.length < 24 || ascii(r, 16, 4) !== "MOBI") return h; // a plain PalmDOC: text only
  const len = u32(r, 20);
  const at = (o: number) => (o + 4 <= 16 + len && o + 4 <= r.length ? u32(r, o) : 0xffffffff);
  h.encoding = u32(r, 28);
  h.version = u32(r, 36);
  h.locale = u32(r, 92);
  const tOff = u32(r, 84);
  const tLen = u32(r, 88);
  h.resourceStart = at(108);
  h.huff = at(112);
  h.huffCount = at(116);
  if (len >= 0xe4 && r.length >= 244) h.extraFlags = u16(r, 242);
  h.ncx = at(244);
  if (h.version >= 8) {
    h.fdst = at(192);
    h.frag = at(248);
    h.skel = at(252);
  }
  const dec = h.encoding === 65001 ? new TextDecoder("utf-8") : new TextDecoder("windows-1252");
  if (tOff + tLen <= r.length) h.title = dec.decode(r.subarray(tOff, tOff + tLen));
  if (u32(r, 128) & 0x40) h.exth = readExth(r, 16 + len, dec);
  return h;
}

function readExth(r: Uint8Array, o: number, dec: TextDecoder): Exth {
  const e: Exth = { authors: [], subjects: [] };
  if (o + 12 > r.length || ascii(r, o, 4) !== "EXTH") return e;
  const count = u32(r, o + 8);
  let p = o + 12;
  for (let i = 0; i < count && p + 8 <= r.length; i++) {
    const type = u32(r, p);
    const size = u32(r, p + 4);
    if (size < 8 || p + size > r.length) break;
    const data = r.subarray(p + 8, p + size);
    const text = () => dec.decode(data).replace(/\0+$/, "").trim();
    const num = () => (data.length >= 4 ? u32(data, 0) : undefined);
    switch (type) {
      case 100:
        if (text()) e.authors.push(text());
        break;
      case 101:
        e.publisher = text() || undefined;
        break;
      case 103:
        e.description = text() || undefined;
        break;
      case 104:
        e.isbn = text().replace(/[^0-9Xx]/g, "") || undefined;
        break;
      case 105:
        if (text()) e.subjects.push(text());
        break;
      case 106:
        e.date = text() || undefined;
        break;
      case 113:
        e.asin = text() || undefined;
        break;
      case 121:
        e.boundary = num();
        break;
      case 122:
        e.fixedLayout = text() === "true";
        break;
      case 201:
        e.cover = num();
        break;
      case 503:
        e.title = text() || undefined;
        break;
      case 524:
        e.language = text() || undefined;
        break;
      case 527:
        e.rtl = text() === "rtl";
        break;
    }
    p += size;
  }
  return e;
}

// ---------------------------------------------------------------- text

/** PalmDOC's LZ77: literals, back-references and "space + letter" pairs. */
export function palmdoc(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(4096, src.length * 8));
  let o = 0;
  let buf = out;
  const put = (b: number) => {
    if (o >= buf.length) {
      const n = new Uint8Array(buf.length * 2);
      n.set(buf);
      buf = n;
    }
    buf[o++] = b;
  };
  for (let i = 0; i < src.length;) {
    const c = src[i++];
    if (c >= 1 && c <= 8) for (let k = 0; k < c && i < src.length; k++) put(src[i++]);
    else if (c < 0x80) put(c);
    else if (c >= 0xc0) {
      put(0x20);
      put(c ^ 0x80);
    } else {
      if (i >= src.length) break;
      const pair = (c << 8) | src[i++];
      const dist = (pair >> 3) & 0x7ff;
      const len = (pair & 7) + 3;
      if (!dist || dist > o) continue;
      for (let k = 0; k < len; k++) put(buf[o - dist]);
    }
  }
  return buf.slice(0, o);
}

/** HUFF/CDIC: Mobipocket's Huffman coding with a phrase dictionary, used by many store books. */
class Huffcdic {
  dict1: [number, boolean, number][] = [];
  mincode: number[] = [];
  maxcode: number[] = [];
  dictionary: ({ bytes: Uint8Array; done: boolean } | null)[] = [];

  constructor(huff: Uint8Array, cdics: Uint8Array[]) {
    if (ascii(huff, 0, 4) !== "HUFF") throw new BookError("not-a-book");
    const off1 = u32(huff, 8);
    const off2 = u32(huff, 12);
    for (let i = 0; i < 256; i++) {
      const v = u32(huff, off1 + i * 4);
      const len = v & 0x1f;
      this.dict1.push([len, !!(v & 0x80), Number(((BigInt(v >>> 8) + 1n) << BigInt(32 - len)) - 1n)]);
    }
    this.mincode.push(0);
    this.maxcode.push(0);
    for (let len = 1; len <= 32; len++) {
      const min = u32(huff, off2 + (len - 1) * 8);
      const max = u32(huff, off2 + (len - 1) * 8 + 4);
      this.mincode.push(Number(BigInt(min) << BigInt(32 - len)));
      this.maxcode.push(Number(((BigInt(max) + 1n) << BigInt(32 - len)) - 1n));
    }
    for (const c of cdics) {
      if (ascii(c, 0, 4) !== "CDIC") throw new BookError("not-a-book");
      const phrases = u32(c, 8);
      const bits = u32(c, 12);
      const n = Math.min(1 << bits, phrases - this.dictionary.length);
      for (let i = 0; i < n; i++) {
        const off = u16(c, 16 + i * 2);
        const blen = u16(c, 16 + off);
        this.dictionary.push({ bytes: c.subarray(18 + off, 18 + off + (blen & 0x7fff)), done: !!(blen & 0x8000) });
      }
    }
  }

  unpack(data: Uint8Array, depth = 0): Uint8Array {
    if (depth > 32) throw new BookError("not-a-book");
    const parts: Uint8Array[] = [];
    let bitsLeft = data.length * 8;
    const padded = new Uint8Array(data.length + 8);
    padded.set(data);
    const view = new DataView(padded.buffer);
    let pos = 0;
    let x = view.getBigUint64(0);
    let n = 32;
    for (;;) {
      if (n <= 0) {
        pos += 4;
        x = view.getBigUint64(pos);
        n += 32;
      }
      const code = Number((x >> BigInt(n)) & 0xffffffffn);
      let [len, term, max] = this.dict1[code >>> 24];
      if (!term) {
        while (len < 32 && code < this.mincode[len]) len++;
        max = this.maxcode[len];
      }
      n -= len;
      bitsLeft -= len;
      if (bitsLeft < 0) break;
      const r = Math.floor((max - code) / 2 ** (32 - len));
      const entry = this.dictionary[r];
      if (!entry) throw new BookError("not-a-book");
      if (!entry.done) {
        this.dictionary[r] = null;
        entry.bytes = this.unpack(entry.bytes, depth + 1);
        entry.done = true;
        this.dictionary[r] = entry;
      }
      parts.push(entry.bytes);
    }
    return concat(parts);
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Bytes some writers append to each text record (indexing hints), which aren't text. */
function trailing(r: Uint8Array, flags: number): number {
  let size = 0;
  const entry = (end: number) => {
    let v = 0;
    let shift = 0;
    for (let i = end - 1; i >= 0 && end - i <= 4; i--) {
      v |= (r[i] & 0x7f) << shift;
      shift += 7;
      if (r[i] & 0x80) break;
    }
    return v;
  };
  for (let f = flags >> 1; f; f >>= 1) if (f & 1) size += entry(r.length - size);
  if (flags & 1) size += (r[r.length - size - 1] & 3) + 1;
  return Math.min(size, r.length);
}

function text(pdb: Pdb, h: Header): Uint8Array {
  let huff: Huffcdic | null = null;
  if (h.compression === 17480) {
    const cdics = [];
    for (let i = 1; i < h.huffCount; i++) cdics.push(pdb.record(h.start + h.huff + i));
    huff = new Huffcdic(pdb.record(h.start + h.huff), cdics);
  } else if (h.compression !== 1 && h.compression !== 2) throw new BookError("not-a-book");
  const parts: Uint8Array[] = [];
  for (let i = 1; i <= h.textRecords; i++) {
    const r = pdb.record(h.start + i);
    const body = r.subarray(0, r.length - trailing(r, h.extraFlags));
    parts.push(h.compression === 2 ? palmdoc(body) : huff ? huff.unpack(body) : body);
  }
  return concat(parts);
}

// ---------------------------------------------------------------- pictures and fonts

interface Resources {
  /** 1-based resource number -> path in the book, for pictures and fonts that could be read. */
  paths: Map<number, string>;
  files: { path: string; bytes: Uint8Array }[];
  cover?: string;
}

function resources(pdb: Pdb, h: Header): Resources {
  const out: Resources = { paths: new Map(), files: [] };
  if (h.resourceStart === 0xffffffff) return out;
  const first = h.resourceStart;
  for (let i = first, n = 1; i < pdb.count; i++, n++) {
    const r = pdb.record(i);
    const tag = r.length >= 4 ? ascii(r, 0, 4) : "";
    if (tag === "BOUN" || tag === "EOF\0" || (r.length === 4 && u32(r, 0) === 0xe98e0d0a)) break;
    const ext = imageExt(r);
    if (ext) {
      const path = `images/image${String(n).padStart(4, "0")}.${ext}`;
      out.paths.set(n, path);
      out.files.push({ path, bytes: r.slice() });
    } else if (tag === "FONT") {
      const font = readFont(r);
      if (font) {
        const path = `fonts/font${String(n).padStart(4, "0")}.${font.ext}`;
        out.paths.set(n, path);
        out.files.push({ path, bytes: font.bytes });
      }
    }
  }
  if (h.exth.cover !== undefined && out.paths.has(h.exth.cover + 1)) out.cover = out.paths.get(h.exth.cover + 1);
  return out;
}

/** KF8 fonts are zlib-compressed and their first bytes XORed with a key; that's packing, not DRM. */
function readFont(r: Uint8Array): { bytes: Uint8Array; ext: string } | null {
  if (r.length < 24) return null;
  const flags = u32(r, 8);
  const start = u32(r, 12);
  const keyLen = u32(r, 16);
  const keyStart = u32(r, 20);
  const data = r.slice(start);
  if (flags & 2 && keyLen) {
    const key = r.subarray(keyStart, keyStart + keyLen);
    for (let i = 0; i < Math.min(1040, data.length); i++) data[i] ^= key[i % keyLen];
  }
  let bytes: Uint8Array = data;
  if (flags & 1) {
    try {
      bytes = unzlibSync(data);
    } catch {
      return null;
    }
  }
  const tag = ascii(bytes, 0, 4);
  const ext = tag === "OTTO" ? "otf" : tag === "wOFF" ? "woff" : tag === "wOF2" ? "woff2" : "ttf";
  return { bytes, ext };
}

// ---------------------------------------------------------------- indexes (KF8 and contents)

const varlen = (b: Uint8Array, i: number) => {
  let value = 0;
  let length = 0;
  for (const byte of b.subarray(i, i + 4)) {
    value = ((value << 7) | (byte & 0x7f)) >>> 0;
    length++;
    if (byte & 0x80) break;
  }
  return { value, length };
};

const bits = (m: number) => {
  let n = 0;
  for (; m; m >>= 1) n += m & 1;
  return n;
};
const trailingZeros = (m: number) => {
  let n = 0;
  for (; m && !(m & 1); m >>= 1) n++;
  return n;
};

interface IndexEntry {
  name: string;
  tags: Map<number, number[]>;
}

function readIndex(pdb: Pdb, at: number): { entries: IndexEntry[]; cncx: Map<number, string> } {
  const r = pdb.record(at);
  if (r.length < 56 || ascii(r, 0, 4) !== "INDX") throw new BookError("not-a-book");
  const len = u32(r, 4);
  const records = u32(r, 24);
  const encoding = u32(r, 28);
  const cncxCount = u32(r, 52);
  const dec = encoding === 65001 ? new TextDecoder("utf-8") : new TextDecoder("windows-1252");
  const tagx = r.subarray(len);
  if (ascii(tagx, 0, 4) !== "TAGX") throw new BookError("not-a-book");
  const controlBytes = u32(tagx, 8);
  const tagTable: [number, number, number, number][] = [];
  for (let i = 12; i < u32(tagx, 4); i += 4) tagTable.push([tagx[i], tagx[i + 1], tagx[i + 2], tagx[i + 3]]);

  const cncx = new Map<number, string>();
  for (let i = 0; i < cncxCount; i++) {
    const c = pdb.record(at + records + i + 1);
    for (let p = 0; p < c.length;) {
      const start = p;
      const { value, length } = varlen(c, p);
      p += length;
      cncx.set(i * 0x10000 + start, dec.decode(c.subarray(p, p + value)));
      p += value;
    }
  }

  const entries: IndexEntry[] = [];
  for (let i = 0; i < records; i++) {
    const rec = pdb.record(at + 1 + i);
    if (ascii(rec, 0, 4) !== "INDX") throw new BookError("not-a-book");
    const idxt = u32(rec, 20);
    const count = u32(rec, 24);
    for (let j = 0; j < count; j++) {
      const off = u16(rec, idxt + 4 + 2 * j);
      const nameLen = rec[off];
      const name = latin1.decode(rec.subarray(off + 1, off + 1 + nameLen));
      const start = off + 1 + nameLen;
      let control = 0;
      let p = start + controlBytes;
      const found: [number, number | null, number | null, number][] = [];
      for (const [tag, perEntry, mask, end] of tagTable) {
        if (end & 1) {
          control++;
          continue;
        }
        const v = rec[start + control] & mask;
        if (v === mask) {
          if (bits(mask) > 1) {
            const { value, length } = varlen(rec, p);
            found.push([tag, null, value, perEntry]);
            p += length;
          } else found.push([tag, 1, null, perEntry]);
        } else found.push([tag, v >> trailingZeros(mask), null, perEntry]);
      }
      const tags = new Map<number, number[]>();
      for (const [tag, count, size, perEntry] of found) {
        const values: number[] = [];
        if (count !== null) {
          for (let k = 0; k < count * perEntry; k++) {
            const { value, length } = varlen(rec, p);
            values.push(value);
            p += length;
          }
        } else {
          for (let used = 0; used < size!;) {
            const { value, length } = varlen(rec, p);
            values.push(value);
            p += length;
            used += length;
          }
        }
        tags.set(tag, values);
      }
      entries.push({ name, tags });
    }
  }
  return { entries, cncx };
}

interface Ncx {
  label: string;
  depth: number;
  /** MOBI: byte offset in the text. */
  pos?: number;
  /** KF8: fragment and offset. */
  fid?: [number, number];
  parent: number;
}

function readNcx(pdb: Pdb, h: Header): Ncx[] {
  if (h.ncx === 0xffffffff) return [];
  try {
    const { entries, cncx } = readIndex(pdb, h.start + h.ncx);
    return entries.map((e) => ({
      label: cncx.get(e.tags.get(3)?.[0] ?? -1) ?? "",
      depth: e.tags.get(4)?.[0] ?? 0,
      pos: e.tags.get(1)?.[0],
      fid: e.tags.has(6) ? [e.tags.get(6)![0], e.tags.get(6)![1]] : undefined,
      parent: e.tags.get(21)?.[0] ?? -1,
    }));
  } catch {
    return [];
  }
}

/** Flat NCX entries with parents into a tree of contents, dropping entries with no place to go. */
function tree(ncx: Ncx[], href: (n: Ncx) => string | null): TocEntry[] {
  const nodes = ncx.map((n) => ({ n, e: { label: n.label.trim() || "Untitled", href: href(n) ?? "", children: [] as TocEntry[] } }));
  const top: TocEntry[] = [];
  nodes.forEach(({ n, e }) => {
    if (!e.href) return;
    const parent = n.parent >= 0 ? nodes[n.parent] : undefined;
    if (parent && parent.e.href) parent.e.children.push(e);
    else top.push(e);
  });
  return top;
}

// ---------------------------------------------------------------- the book

export interface MobiDetails {
  title: string;
  authors: string[];
  locked: boolean;
}

/** Details from the header alone, which stays readable when the text is locked. */
export function mobiDetails(bytes: Uint8Array): MobiDetails {
  const pdb = new Pdb(bytes);
  const h = readHeader(pdb, 0);
  return { title: h.exth.title || h.title || ascii(bytes, 0, 32).replace(/\0.*$/s, ""), authors: h.exth.authors.map(nameOrder), locked: h.encryption !== 0 };
}

/** "Brown, Pierce" -> "Pierce Brown". Kindle files often store authors sorted. */
const nameOrder = (a: string) => (/^[^,]+,\s*[^,]+$/.test(a) && !/\b(jr|sr|inc|ltd)\b/i.test(a) ? a.replace(/^([^,]+),\s*(.+)$/, "$2 $1") : a);

const LANGS: Record<number, string> = {
  9: "en",
  7: "de",
  12: "fr",
  10: "es",
  16: "it",
  19: "nl",
  22: "pt",
  25: "ru",
  17: "ja",
  4: "zh",
  29: "sv",
  6: "da",
  20: "no",
  11: "fi",
  21: "pl",
  18: "ko",
};

/** Throws BookError("drm") for a book whose text is encrypted. */
export function mobiToDraft(bytes: Uint8Array): Draft {
  const pdb = new Pdb(bytes);
  const first = readHeader(pdb, 0);
  if (first.encryption !== 0) throw new BookError("drm");
  let h = first;
  if (first.exth.boundary !== undefined && first.exth.boundary < pdb.count && first.version < 8) {
    try {
      const kf8 = readHeader(pdb, first.exth.boundary);
      if (kf8.version >= 8) h = { ...kf8, exth: { ...first.exth, ...kf8.exth, authors: kf8.exth.authors.length ? kf8.exth.authors : first.exth.authors } };
    } catch {
      /* keep the MOBI half */
    }
  }
  if (h.encryption !== 0) throw new BookError("drm");
  // Pictures are shared by both halves of a combo file and counted from the first header.
  const res = resources(pdb, first);
  const draft: Draft = h.version >= 8 && h.skel !== 0xffffffff ? kf8(pdb, h, res) : mobi6(pdb, h, res);
  const e = h.exth;
  draft.title = e.title || h.title || draft.title;
  draft.authors = e.authors.map(nameOrder);
  draft.publisher = e.publisher;
  draft.description = e.description
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  draft.isbn = e.isbn && /^(97[89])?\d{9}[\dX]$/i.test(e.isbn) ? e.isbn : undefined;
  draft.date = e.date;
  draft.subjects = e.subjects;
  draft.language = e.language || LANGS[h.locale & 0xff];
  draft.rtl = e.rtl;
  draft.cover = res.cover;
  return draft;
}

// MOBI: one HTML stream, links by byte offset.
function mobi6(pdb: Pdb, h: Header, res: Resources): Draft {
  let raw = text(pdb, h);
  // An anchor at every byte offset something links to, put in before decoding so the offsets still hold.
  const src = latin1.decode(raw);
  const targets = new Set<number>();
  for (const m of src.matchAll(/filepos\s*=\s*["']?0*(\d+)/gi)) targets.add(Number(m[1]));
  const ncx = readNcx(pdb, h);
  for (const n of ncx) if (n.pos !== undefined) targets.add(n.pos);
  const toc = src.match(/<reference\b[^>]*type\s*=\s*["']?toc["']?[^>]*filepos\s*=\s*["']?0*(\d+)/i);
  if (toc) targets.add(Number(toc[1]));
  const sorted = [...targets].filter((t) => t < raw.length).sort((a, b) => a - b);
  if (sorted.length) {
    const parts: Uint8Array[] = [];
    let last = 0;
    for (const t of sorted) {
      // Inside a tag, the anchor goes just before it.
      let at = t;
      const lt = src.lastIndexOf("<", t);
      if (lt > src.lastIndexOf(">", t - 1) && lt >= last) at = lt;
      if (at < last) continue;
      parts.push(raw.subarray(last, at), new TextEncoder().encode(`<a id="filepos${t}"></a>`));
      last = at;
    }
    parts.push(raw.subarray(last));
    raw = concat(parts);
  }
  let html = h.encoding === 65001 ? new TextDecoder("utf-8").decode(raw) : new TextDecoder("windows-1252").decode(raw);
  html = html.replace(/<guide>[\s\S]*?<\/guide>/gi, "");

  // Chapters at each page break, and wherever the contents point inside one long run.
  const pieces = html.split(/<mbp:pagebreak\s*\/?>/i);
  const chapters = pieces.map((p, i) => ({ name: `text${String(i + 1).padStart(4, "0")}.xhtml`, html: p }));
  const where = new Map<string, string>();
  for (const c of chapters) for (const m of c.html.matchAll(/<a id="(filepos\d+)"/g)) where.set(m[1], c.name);

  for (const c of chapters) {
    const s = c.html
      .replace(/<\/?(html|head|body)\b[^>]*>/gi, "")
      .replace(/<\/?mbp:[^>]*>/gi, "")
      .replace(/\bfilepos\s*=\s*["']?0*(\d+)["']?/gi, (_m, n) => `href="${where.get(`filepos${n}`) ?? ""}#filepos${n}"`)
      .replace(/<img\b([^>]*?)\brecindex\s*=\s*["']?(\d+)["']?([^>]*)>/gi, (_m, a, n, b) => {
        const path = res.paths.get(Number(n));
        return path ? `<img${a} src="${path}"${b.replace(/\/\s*$/, "")}/>` : "";
      })
      // Mobipocket spacing attributes: height is space above, a negative width is a first-line indent.
      .replace(/<(p|div)\b([^>]*)>/gi, (_m, tag, attrs: string) => {
        let style = "";
        attrs = attrs.replace(/\s(height|width)\s*=\s*["']?(-?[\d.]+)(em|pt|px|%)?["']?/gi, (_a, k, v, unit) => {
          const n = Number(v);
          if (k.toLowerCase() === "height" && n > 0) style += `margin-top:${n}${unit ?? "em"};`;
          if (k.toLowerCase() === "width") style += `text-indent:${n}${unit ?? "em"};`;
          return "";
        });
        return `<${tag}${attrs}${style ? ` style="${style}"` : ""}>`;
      });
    c.html = pageOf(h.exth.title || h.title, s);
  }
  // Empty pieces (a break at the very start or end) aren't pages.
  const kept = chapters.filter(
    (c) =>
      /<img\b|[^\s<>]/.test(
        c.html
          .replace(/<head>[\s\S]*?<\/head>/, "")
          .replace(/<[^>]+>/g, "")
          .trim(),
      ) || /<img\b/i.test(c.html),
  );

  let contents: TocEntry[] = tree(ncx, (n) => (n.pos !== undefined && where.has(`filepos${n.pos}`) ? `${where.get(`filepos${n.pos}`)}#filepos${n.pos}` : null));
  if (!contents.length && toc) {
    // The book's own contents page: its links, in order.
    const page = chapters.find((c) => c.name === where.get(`filepos${toc[1]}`));
    if (page)
      contents = [...page.html.matchAll(/<a\b[^>]*href="([^"#]+#filepos\d+)"[^>]*>([\s\S]*?)<\/a>/gi)]
        .map((m) => ({
          label: m[2]
            .replace(/<[^>]+>/g, "")
            .replace(/\s+/g, " ")
            .trim(),
          href: m[1],
        }))
        .filter((e) => e.label);
  }
  return { title: h.title, authors: [], chapters: kept.length ? kept : chapters, resources: res.files, toc: contents };
}

const base32 = (s: string) => parseInt(s, 32);

// KF8: XHTML files split into a skeleton and fragments, styles in separate flows.
function kf8(pdb: Pdb, h: Header, res: Resources): Draft {
  const raw = text(pdb, h);
  // Flows: 0 is the text; the others are style sheets and SVG.
  let flows: [number, number][] = [[0, raw.length]];
  if (h.fdst !== 0xffffffff) {
    const f = pdb.record(h.start + h.fdst);
    if (ascii(f, 0, 4) === "FDST") {
      flows = [];
      for (let i = 0; i < u32(f, 8); i++) flows.push([u32(f, 12 + i * 8), u32(f, 16 + i * 8)]);
    }
  }
  const utf8 = new TextDecoder("utf-8");
  const flowFiles = new Map<number, { path: string; bytes: Uint8Array }>();
  for (let i = 1; i < flows.length; i++) {
    const bytes = raw.subarray(flows[i][0], flows[i][1]);
    const s = utf8.decode(bytes.subarray(0, 200));
    const ext = /<svg\b/i.test(s) ? "svg" : "css";
    flowFiles.set(i, { path: `styles/flow${String(i).padStart(4, "0")}.${ext}`, bytes });
  }
  const main = raw.subarray(flows[0][0], flows[0][1]);

  const skel = readIndex(pdb, h.start + h.skel).entries.map((e) => ({
    frags: e.tags.get(1)?.[0] ?? 0,
    offset: e.tags.get(6)?.[0] ?? 0,
    length: e.tags.get(6)?.[1] ?? 0,
  }));
  const frag = readIndex(pdb, h.start + h.frag).entries.map((e) => ({
    insert: Number(e.name),
    offset: e.tags.get(6)?.[0] ?? 0,
    length: e.tags.get(6)?.[1] ?? 0,
  }));

  // Assemble each file: the skeleton with its fragments put back in.
  const files: { name: string; bytes: Uint8Array; skelOffset: number; fragStart: number; fragEnd: number }[] = [];
  let fi = 0;
  let pos = 0;
  skel.forEach((s, i) => {
    const frags = frag.slice(fi, fi + s.frags);
    const total = s.length + frags.reduce((n, f) => n + f.length, 0);
    const section = main.subarray(pos, pos + total);
    let out: Uint8Array = section.slice(0, s.length);
    for (const f of frags) {
      const at = Math.max(0, Math.min(out.length, f.insert - s.offset));
      const piece = section.subarray(s.length + f.offset, s.length + f.offset + f.length);
      out = concat([out.subarray(0, at), piece, out.subarray(at)]);
    }
    files.push({ name: `part${String(i).padStart(4, "0")}.xhtml`, bytes: out, skelOffset: s.offset, fragStart: fi, fragEnd: fi + s.frags });
    fi += s.frags;
    pos += total;
  });
  const texts = files.map((f) => utf8.decode(f.bytes));

  // kindle:pos:fid:X:off:Y -> the first element with an id or aid at that spot.
  const extraIds = new Map<number, Set<string>>();
  const resolve = (fid: number, off: number): string | null => {
    const fileIndex = files.findIndex((f) => fid >= f.fragStart && fid < f.fragEnd);
    if (fileIndex < 0 || !frag[fid]) return null;
    const f = files[fileIndex];
    const at = frag[fid].insert - f.skelOffset + off;
    const after = latin1.decode(f.bytes.subarray(Math.max(0, at)));
    const m = after.match(/<[^>]*?\s(id|aid)\s*=\s*["']([^"']+)["']/i);
    if (!m) return f.name;
    if (m[1].toLowerCase() === "id") return `${f.name}#${m[2]}`;
    if (!extraIds.has(fileIndex)) extraIds.set(fileIndex, new Set());
    extraIds.get(fileIndex)!.add(m[2]);
    return `${f.name}#aid-${m[2]}`;
  };
  // Pages sit beside images/, fonts/ and styles/; style sheets sit inside styles/, one folder down.
  const link = (s: string, up: string) =>
    s
      .replace(/kindle:pos:fid:([0-9A-V]{4}):off:([0-9A-V]{10})/g, (_m, a, b) => resolve(base32(a), base32(b)) ?? "#")
      .replace(/kindle:embed:([0-9A-V]{4})(\?mime=[^"')\s]*)?/g, (_m, n) => {
        const p = res.paths.get(base32(n));
        return p ? up + p : "";
      })
      .replace(/kindle:flow:([0-9A-V]{4})(\?mime=[^"')\s]*)?/g, (_m, n) => {
        const p = flowFiles.get(base32(n))?.path;
        return p ? (up && p.startsWith("styles/") ? p.slice(7) : up + p) : "";
      });

  const contents = tree(readNcx(pdb, h), (n) => (n.fid ? resolve(n.fid[0], n.fid[1]) : null));
  const pages = texts.map((t) => link(t, ""));
  const chapters = pages.map((t, i) => {
    let s = t;
    const ids = extraIds.get(i);
    if (ids)
      s = s.replace(/<([a-zA-Z][\w:-]*)(\s[^>]*?\said\s*=\s*["']([^"']+)["'][^>]*)>/g, (m, tag, attrs, aid) =>
        ids.has(aid) && !/\sid\s*=/.test(attrs) ? `<${tag} id="aid-${aid}"${attrs}>` : m,
      );
    // Kindle's own bookkeeping attributes mean nothing to other readers.
    s = s.replace(/\s(aid|amzn-src-id|data-AmznRemoved(-M8)?|data-AmznPageBreak)\s*=\s*["'][^"']*["']/g, "");
    return { name: files[i].name, html: s };
  });
  const flowRes = [...flowFiles.values()].map((f) => ({
    path: f.path,
    bytes: f.path.endsWith(".css") ? new TextEncoder().encode(link(utf8.decode(f.bytes), "../")) : f.bytes,
  }));
  return { title: h.title, authors: [], chapters, resources: [...res.files, ...flowRes], toc: contents };
}
