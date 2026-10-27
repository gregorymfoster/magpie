// A cover for a book that has none: its title and author set in Newsreader on
// one of the three house designs the window already draws for coverless
// books (ui/src/components/Cover.tsx), in the same colour for the same book.
// So the cover a reader shows is the one Magpie showed all along.

/// <reference path="./opentype.d.ts" />
import * as opentype from "opentype.js";
import { LATIN, LATIN_EXT } from "./newsreader.ts";
import { Raster, hex, type Rgb, type Shape } from "./raster.ts";

export const COVER_W = 1000;
export const COVER_H = 1500;

// Kept in step with Cover.tsx.
const TONES = [
  "#6B2232",
  "#7A2E2A",
  "#5A6B47",
  "#85817B",
  "#B9B1A6",
  "#A27E57",
  "#3A2F29",
  "#3F4954",
  "#E7DFD1",
  "#8B4A33",
  "#6B6744",
  "#CFC5B6",
  "#24303A",
  "#7D7E80",
];
const LIGHT = new Set(["#B9B1A6", "#E7DFD1", "#CFC5B6"]);

/** A PNG cover for this title and these authors. The same book always gets the same cover. */
export function makeCover(title: string, authors: string[]): Uint8Array {
  const h = hash(title + authors.join());
  const bgHex = TONES[h % TONES.length];
  const bg = hex(bgHex);
  const ink = hex(LIGHT.has(bgHex) ? "#2B2622" : "#F1EADF");
  const style = h % 3;
  const name = title.length > 60 ? title.split(/[;:]/)[0].trim() : title.trim() || "Untitled";
  const by = (authors.length ? authors.join(" & ") : "Unknown author").toUpperCase();
  const r = new Raster(COVER_W, COVER_H, bg);
  // Lengths below are in the window's units: cqw, a hundredth of the cover's width.
  const u = COVER_W / 100;
  const line = Math.max(3, Math.round(u * 0.3));

  if (style === 0) {
    const inset = 6 * u;
    frame(r, inset, inset, COVER_W - 2 * inset, COVER_H - 2 * inset, line, ink, 0.4);
    const left = inset + 10 * u;
    const width = COVER_W - 2 * left;
    const t = setText(name, width, 12 * u, 1.05, 5, 0);
    let y = inset + 18 * u;
    y = draw(r, t, left, y, width, "center", ink);
    r.rect((COVER_W - 22 * u) / 2, y + 7 * u, 22 * u, line, ink, 0.55);
    const a = setText(by, width, 6.6 * u, 1.2, 2, 0.14);
    draw(r, a, left, COVER_H - inset - 12 * u - a.height, width, "center", ink);
  } else if (style === 1) {
    const band = Math.round(COVER_H * 0.62);
    const width = COVER_W - 20 * u;
    const t = setText(name, width, 12 * u, 1.05, 5, 0);
    draw(r, t, 10 * u, band - 8 * u - t.height, width, "center", ink);
    r.rect(0, band, COVER_W, COVER_H - band, [255, 255, 255], 0.88);
    const a = setText(by, width, 6.6 * u, 1.2, 2, 0.14);
    draw(r, a, 10 * u, band + (COVER_H - band - a.height) / 2, width, "center", hex("#2B2622"));
  } else {
    r.rect(8 * u, 0, 3 * u, COVER_H, hex("#6B2232"));
    r.rect(8 * u + 3.6 * u + 1.2 * u, 0, 3 * u - 2.4 * u, COVER_H, [255, 255, 255], 0.35);
    const left = 20 * u;
    const width = COVER_W - left - 10 * u;
    const t = setText(name, width, 12 * u, 1.05, 5, 0);
    const y = draw(r, t, left, 12 * u, width, "left", ink);
    r.rect(left, y + 7 * u, 22 * u, line, ink, 0.55);
    const a = setText(by, width, 6.6 * u, 1.2, 2, 0.14);
    draw(r, a, left, COVER_H - 12 * u - a.height, width, "left", ink);
  }
  return r.png();
}

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function frame(r: Raster, x: number, y: number, w: number, h: number, t: number, c: Rgb, a: number) {
  r.rect(x, y, w, t, c, a);
  r.rect(x, y + h - t, w, t, c, a);
  r.rect(x, y + t, t, h - 2 * t, c, a);
  r.rect(x + w - t, y + t, t, h - 2 * t, c, a);
}

// ------------------------------------------------------------ type

type Font = { unitsPerEm: number; ascender: number; descender: number; charToGlyphIndex(c: string): number; charToGlyph(c: string): Glyph };
type Glyph = { advanceWidth?: number; getPath(x: number, y: number, size: number): { commands: Cmd[] } };
type Cmd = { type: "M" | "L" | "Q" | "C" | "Z"; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number };

let fonts: Font[] | null = null;
function loadFonts(): Font[] {
  // Node loads the UMD build (everything on `default`), the window's bundler the ES module (named exports).
  const mod = opentype as Record<string, unknown>;
  const ot = ("parse" in mod ? mod : mod["default"]) as { parse(b: ArrayBuffer): Font };
  return (fonts ??= [LATIN, LATIN_EXT].map((b64) => ot.parse(bytes(b64).buffer as ArrayBuffer)));
}

function bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The first font with a glyph for this character; Newsreader's latin set, then latin-ext. */
function fontFor(ch: string): Font {
  const [latin, ext] = loadFonts();
  return latin.charToGlyphIndex(ch) || !ext.charToGlyphIndex(ch) ? latin : ext;
}

interface Set {
  lines: string[];
  size: number;
  lead: number;
  track: number;
  height: number;
}

function advance(text: string, size: number, track: number): number {
  let w = 0;
  for (const ch of text) {
    const f = fontFor(ch);
    w += ((f.charToGlyph(ch).advanceWidth ?? 0) / f.unitsPerEm) * size + track * size;
  }
  return w - (text ? track * size : 0);
}

/**
 * Break text into at most `max` lines that fit `width`, shrinking the size
 * until it does, then even the lines out the way CSS's text-wrap: balance does.
 */
function setText(text: string, width: number, size: number, lead: number, max: number, track: number): Set {
  const words = text.split(/\s+/).filter(Boolean);
  for (let s = size; ; s *= 0.92) {
    const fits = (w: number) => wrap(words, w, s, track);
    const lines = fits(width);
    if ((lines && lines.length <= max) || s < size * 0.3) {
      let out = lines ?? [text];
      // Balance: the narrowest width that keeps the same number of lines.
      let lo = width * 0.5;
      let hi = width;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        const l = fits(mid);
        if (l && l.length === out.length) hi = mid;
        else lo = mid;
      }
      out = fits(hi) ?? out;
      return { lines: out, size: s, lead, track, height: out.length * s * lead };
    }
  }
}

function wrap(words: string[], width: number, size: number, track: number): string[] | null {
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (advance(w, size, track) > width) return null;
    const next = cur ? `${cur} ${w}` : w;
    if (advance(next, size, track) <= width) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Draw set text with its top at y; returns the bottom. */
function draw(r: Raster, t: Set, left: number, y: number, width: number, align: "left" | "center", ink: Rgb): number {
  const [latin] = loadFonts();
  const ascent = (latin.ascender / (latin.ascender - latin.descender)) * t.size;
  const half = (t.lead * t.size - t.size) / 2;
  t.lines.forEach((text, i) => {
    let x = align === "center" ? left + (width - advance(text, t.size, t.track)) / 2 : left;
    const base = y + i * t.lead * t.size + half + ascent;
    const shape: Shape = [];
    for (const ch of text) {
      const f = fontFor(ch);
      const g = f.charToGlyph(ch);
      shape.push(...polygons(g.getPath(x, base, t.size).commands));
      x += ((g.advanceWidth ?? 0) / f.unitsPerEm) * t.size + t.track * t.size;
    }
    r.fill(shape, ink);
  });
  return y + t.height;
}

/** Glyph outlines as polygons, curves cut into short straight pieces. */
function polygons(cmds: Cmd[]): Shape {
  const out: Shape = [];
  let poly: number[] = [];
  let x = 0;
  let y = 0;
  const STEPS = 10;
  for (const c of cmds) {
    if (c.type === "M") {
      if (poly.length > 4) out.push(poly);
      poly = [c.x!, c.y!];
    } else if (c.type === "L") poly.push(c.x!, c.y!);
    else if (c.type === "Q") {
      for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        const m = 1 - t;
        poly.push(m * m * x + 2 * m * t * c.x1! + t * t * c.x!, m * m * y + 2 * m * t * c.y1! + t * t * c.y!);
      }
    } else if (c.type === "C") {
      for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        const m = 1 - t;
        poly.push(
          m * m * m * x + 3 * m * m * t * c.x1! + 3 * m * t * t * c.x2! + t * t * t * c.x!,
          m * m * m * y + 3 * m * m * t * c.y1! + 3 * m * t * t * c.y2! + t * t * t * c.y!,
        );
      }
    } else if (c.type === "Z") {
      if (poly.length > 4) out.push(poly);
      poly = [];
      continue;
    }
    x = c.x!;
    y = c.y!;
  }
  if (poly.length > 4) out.push(poly);
  return out;
}
