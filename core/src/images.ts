// Reading an image's pixel size from its header, without decoding it.

import { decodeUtf8 } from "./epub.ts";

/** Width and height from an image's header (JPEG, PNG, GIF, WebP), or null when it can't be read. SVG has no pixel size and passes. */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const le16 = (i: number) => b[i] | (b[i + 1] << 8);
  const le24 = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: u32(16), h: u32(20) };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: le16(6), h: le16(8) };
  if (b.length > 30 && decodeUtf8(b.subarray(0, 4)) === "RIFF" && decodeUtf8(b.subarray(8, 12)) === "WEBP") {
    const kind = decodeUtf8(b.subarray(12, 16));
    if (kind === "VP8 ") return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    if (kind === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X") return { w: le24(24) + 1, h: le24(27) + 1 };
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      // Start of frame (any kind except the DHT, JPG and DAC markers that share the range).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { w: u16(i + 7), h: u16(i + 5) };
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      i += 2 + u16(i + 2);
    }
    return null;
  }
  if (/<svg[\s>]/.test(decodeUtf8(b.subarray(0, 2048)))) return { w: Infinity, h: Infinity };
  return null;
}

/** "image/jpeg" or "image/png" when the bytes are one with a readable size: the two cover formats every reader shows. */
export function coverType(b: Uint8Array): "image/jpeg" | "image/png" | null {
  const size = imageSize(b);
  if (!size || !size.w || !size.h) return null;
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  return null;
}
