// Is a book clean? After the fixers have run, the finished book is checked
// against a fixed list. Every item that fails becomes a to-do: a sentence for
// a person and the one thing that settles it. A book with no to-dos and no
// suggestions waiting is Clean; anything else Needs work.
//
// Missing nice-to-haves (year, description, series) are not to-dos. Clean has
// to be reachable for nearly every book, or the badge means nothing.

import { decodeUtf8, type Book } from "./epub.ts";
import { contentDocs } from "./fixers/xhtml.ts";
import { unsureTitles } from "./fixers/layout.ts";
import { imageSize } from "./images.ts";
import { JUNK_AUTHOR, isJunkTitle } from "./identify/rules.ts";
import { coverImage, type BookInfo } from "./info.ts";
import type { FixReport } from "./fix.ts";

export type TodoId = "no-cover" | "small-cover" | "bad-cover" | "no-title" | "no-author" | "no-language" | "fixer-failed" | "no-text" | "unsure-titles";

export interface Todo {
  id: TodoId;
  /** What's wrong, as a sentence. */
  message: string;
  /** What settles it: edit details, review suggestions, preview the book, or add a cover. */
  action: "edit" | "preview" | "cover";
}

/** Covers shorter than this look blurry even in a reader's library grid. (Kindle asks for 1600 for its sleep screen; most store covers are 500.) */
export const MIN_COVER_HEIGHT = 480;

/** `keepStyle`: the person chose the publisher's design, so layout doubts aren't to-dos. */
export function checkBook(book: Book, info: BookInfo, errors: FixReport["errors"], keepStyle = false): Todo[] {
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
  const unsure = keepStyle ? 0 : unsureTitles(book);
  if (unsure >= 2)
    out.push({
      id: "unsure-titles",
      message: `${unsure} chapters start with a bold line that may be a title. Magpie left them as they are; look at them in Preview.`,
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
