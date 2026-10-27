// Just enough drawing to make a cover: flat colours, rectangles and filled
// outlines (glyphs), antialiased, written out as a PNG. No canvas, so it runs
// the same in the Node host, the app's worker and the tests.

import { zlibSync } from "fflate";

export type Rgb = [number, number, number];

/** A shape as closed polygons, each a flat list of x, y pairs. */
export type Shape = number[][];

export class Raster {
  readonly w: number;
  readonly h: number;
  private px: Uint8Array;

  constructor(w: number, h: number, bg: Rgb) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.px.set(bg, i * 3);
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb, alpha = 1) {
    this.fill([[x, y, x + w, y, x + w, y + h, x, y + h]], color, alpha);
  }

  /** Fill with the nonzero rule, 4 sub-rows per pixel and exact coverage across. */
  fill(shape: Shape, color: Rgb, alpha = 1) {
    const edges: [number, number, number, number, number][] = [];
    let top = Infinity;
    let bottom = -Infinity;
    for (const poly of shape) {
      for (let i = 0; i < poly.length; i += 2) {
        const x0 = poly[i];
        const y0 = poly[i + 1];
        const x1 = poly[(i + 2) % poly.length];
        const y1 = poly[(i + 3) % poly.length];
        if (y0 === y1) continue;
        const dir = y1 > y0 ? 1 : -1;
        const [ya, yb, xa, xb] = dir === 1 ? [y0, y1, x0, x1] : [y1, y0, x1, x0];
        edges.push([ya, yb, xa, (xb - xa) / (yb - ya), dir]);
        top = Math.min(top, ya);
        bottom = Math.max(bottom, yb);
      }
    }
    if (!edges.length) return;
    const SUB = 4;
    const cov = new Float32Array(this.w + 1);
    const hits: [number, number][] = [];
    for (let row = Math.max(0, Math.floor(top)); row < Math.min(this.h, Math.ceil(bottom)); row++) {
      cov.fill(0);
      let any = false;
      for (let s = 0; s < SUB; s++) {
        const y = row + (s + 0.5) / SUB;
        hits.length = 0;
        for (const [ya, yb, xa, slope, dir] of edges) if (y >= ya && y < yb) hits.push([xa + (y - ya) * slope, dir]);
        if (hits.length < 2) continue;
        hits.sort((a, b) => a[0] - b[0]);
        let wind = 0;
        for (let i = 0; i < hits.length - 1; i++) {
          wind += hits[i][1];
          if (!wind) continue;
          this.span(cov, hits[i][0], hits[i + 1][0], 1 / SUB);
          any = true;
        }
      }
      if (!any) continue;
      for (let x = 0; x < this.w; x++) {
        const a = Math.min(1, cov[x]) * alpha;
        if (a <= 0) continue;
        const i = (row * this.w + x) * 3;
        for (let c = 0; c < 3; c++) this.px[i + c] = Math.round(this.px[i + c] + (color[c] - this.px[i + c]) * a);
      }
    }
  }

  private span(cov: Float32Array, a: number, b: number, weight: number) {
    a = Math.max(0, Math.min(this.w, a));
    b = Math.max(0, Math.min(this.w, b));
    if (b <= a) return;
    const ia = Math.floor(a);
    const ib = Math.floor(b);
    if (ia === ib) {
      cov[ia] += (b - a) * weight;
      return;
    }
    cov[ia] += (ia + 1 - a) * weight;
    for (let x = ia + 1; x < ib; x++) cov[x] += weight;
    if (ib < this.w) cov[ib] += (b - ib) * weight;
  }

  png(): Uint8Array {
    const raw = new Uint8Array((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) raw.set(this.px.subarray(y * this.w * 3, (y + 1) * this.w * 3), y * (this.w * 3 + 1) + 1);
    const ihdr = new Uint8Array(13);
    const v = new DataView(ihdr.buffer);
    v.setUint32(0, this.w);
    v.setUint32(4, this.h);
    ihdr.set([8, 2, 0, 0, 0], 8);
    return concat([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlibSync(raw, { level: 9 })),
      chunk("IEND", new Uint8Array()),
    ]);
  }
}

export function hex(s: string): Rgb {
  const n = parseInt(s.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let c = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) c = CRC[(c ^ out[i]) & 255] ^ (c >>> 8);
  v.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
