// Is a book clean? After the fixers have run, the finished book is checked
// against a fixed list. Every item that fails becomes a to-do: a sentence for
// a person and the one thing that settles it. A book with no to-dos and no
// suggestions waiting is Clean; anything else Needs work.
//
// Missing nice-to-haves (year, description, series) are not to-dos. Clean has
// to be reachable for nearly every book, or the badge means nothing.

import { decodeUtf8, type Book } from "./epub.ts";
import { contentDocs } from "./fixers/xhtml.ts";
import { JUNK_AUTHOR, isJunkTitle } from "./identify/rules.ts";
import { coverImage, type BookInfo } from "./info.ts";
import type { FixReport } from "./fix.ts";

export type TodoId = "no-cover" | "small-cover" | "bad-cover" | "no-title" | "no-author" | "no-language" | "fixer-failed" | "no-text";

export interface Todo {
  id: TodoId;
  /** What's wrong, as a sentence. */
  message: string;
  /** What settles it: edit details, review suggestions, preview the book, or add a cover. */
  action: "edit" | "preview" | "cover";
}

/** Covers shorter than this look soft on a 300 ppi reader. Kindle asks for 1600 or more. */
export const MIN_COVER_HEIGHT = 800;

export function checkBook(book: Book, info: BookInfo, errors: FixReport["errors"]): Todo[] {
  const out: Todo[] = [];
  const c = coverImage(book);
  if (!c) out.push({ id: "no-cover", message: "No cover. Readers will show a plain grey square.", action: "cover" });
  else {
    const size = imageSize(book.files.get(c.path)!);
    if (!size) out.push({ id: "bad-cover", message: "The cover image is damaged and won't show on most readers.", action: "cover" });
    else if (size.h < MIN_COVER_HEIGHT)
      out.push({ id: "small-cover", message: `The cover is small (${size.w} × ${size.h}) and will look blurry on a reader.`, action: "cover" });
  }
  if (!info.title || isJunkTitle(info.title)) out.push({ id: "no-title", message: "The book has no real title.", action: "edit" });
  if (!info.authors.length || JUNK_AUTHOR.test(info.authors[0])) out.push({ id: "no-author", message: "The book doesn't say who wrote it.", action: "edit" });
  if (!info.language)
    out.push({ id: "no-language", message: "The book doesn't say what language it's in, so readers may hyphenate it wrongly.", action: "edit" });
  if (errors.length)
    out.push({
      id: "fixer-failed",
      message: `Part of the repair couldn't finish (${errors.map((e) => e.fixer).join(", ")}). Look through it before sending.`,
      action: "preview",
    });
  if (!hasText(book)) out.push({ id: "no-text", message: "Magpie found no text in this book. It may be all images, or empty.", action: "preview" });
  return out;
}

function hasText(book: Book): boolean {
  for (const p of contentDocs(book)) {
    const s = decodeUtf8(book.files.get(p)!);
    const body = s.slice(s.search(/<body[\s>]/i));
    if (/[\p{L}\p{N}]{3}/u.test(body.replace(/<[^>]*>/g, " "))) return true;
  }
  return false;
}

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
