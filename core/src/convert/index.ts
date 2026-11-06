// Books that don't come as EPUB. Each is turned into a plain EPUB once, when
// it's added; the fixers then clean that like any other book. The file a
// person added is kept untouched as the original, under its own ending.
//
// What a file is comes from its first bytes, not its name: a .mobi that is
// really an EPUB is read as an EPUB.

import { unzipSync } from "fflate";
import { BookError } from "../epub.ts";
import { isMobi, mobiDetails, mobiToDraft } from "./mobi.ts";
import { fb2ToDraft } from "./fb2.ts";
import { textToDraft, htmlToDraft } from "./text.ts";
import { pdfLocked, pdfToDraft } from "./pdf.ts";
import { pack } from "./pack.ts";

export type Kind = "epub" | "mobi" | "pdf" | "fb2" | "txt" | "html";

/** How "What Magpie did" names each. */
export const KIND_NAMES: Record<Exclude<Kind, "epub">, string> = {
  mobi: "Kindle file (MOBI/AZW3)",
  pdf: "PDF",
  fb2: "FictionBook file",
  txt: "plain text file",
  html: "web page",
};

/** Bump when a converter changes what it writes, so converted books are made again. */
export const CONVERTER = 1;

/** File endings Magpie will try. Folders are searched for these. */
export const BOOK_ENDINGS = ["epub", "kepub", "mobi", "azw", "azw3", "kf8", "prc", "pdb", "pdf", "fb2", "txt", "text", "htm", "html", "xhtml"];
/** Archives whose books are taken out and added one by one. */
export const ARCHIVE_ENDINGS = ["zip"];

export const ending = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

const head = (b: Uint8Array, n = 512) => new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, n));

/** What kind of book these bytes are, or null when they're none Magpie reads. */
export function sniff(bytes: Uint8Array, name = ""): Kind | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // A zipped FictionBook (.fb2.zip) is one book; any other zip is an EPUB or nothing.
    if (/\.fb2\.zip$/i.test(name)) return "fb2";
    // A zip is an EPUB when it names a package somewhere (file names are plain text in a zip); damaged ones still count.
    const names = new TextDecoder("latin1").decode(bytes.length > 4_000_000 ? bytes.subarray(bytes.length - 2_000_000) : bytes);
    return /mimetype|META-INF\/|\.opf|\.x?html?/i.test(names) ? "epub" : null;
  }
  if (isMobi(bytes)) return "mobi";
  if (head(bytes, 1024).includes("%PDF-")) return "pdf";
  const start = head(bytes, 2048).replace(/^﻿/, "");
  if (/<FictionBook\b/.test(start)) return "fb2";
  const end = ending(name);
  if (/^\s*(<\?xml[^>]*>\s*)?(<!DOCTYPE html|<html\b)/i.test(start) || ["htm", "html", "xhtml"].includes(end)) return "html";
  if (["txt", "text"].includes(end) && !bytes.subarray(0, 4096).includes(0)) return "txt";
  return null;
}

/** Book files inside a zip that isn't itself an EPUB, by name. Empty for an EPUB, a zipped FB2 or a zip with no books. */
export function archiveBooks(bytes: Uint8Array): { name: string; bytes: Uint8Array }[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => !f.name.endsWith("/") && !/(^|\/)(__MACOSX|\.)/.test(f.name) && f.originalSize < 1_500_000_000 });
  } catch {
    return [];
  }
  if ("mimetype" in files || "META-INF/container.xml" in files) return [];
  return Object.entries(files)
    .filter(
      ([name]) =>
        [...BOOK_ENDINGS.filter((e) => !["txt", "text", "htm", "html", "xhtml"].includes(e)), "zip"].includes(ending(name)) || /\.fb2\.zip$/i.test(name),
    )
    .map(([name, b]) => ({ name: name.split("/").pop()!, bytes: b }));
}

/** A store lock on a non-EPUB book: true when its text can't be read. Its title and authors still can. */
export function lockedDetails(bytes: Uint8Array, kind: Kind): { title: string; authors: string[] } | null {
  if (kind === "mobi") {
    const d = mobiDetails(bytes);
    return d.locked ? d : null;
  }
  if (kind === "pdf" && pdfLocked(bytes)) return { title: "", authors: [] };
  return null;
}

/** An EPUB made from a book in another format. Throws BookError: "drm" when locked, "not-a-book" or "no-text" when it can't be read. */
export async function toEpub(bytes: Uint8Array, kind: Kind, name = ""): Promise<Uint8Array> {
  if (!bytes.length) throw new BookError("empty");
  if (kind === "epub") return bytes;
  const stem = name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .trim();
  const draft =
    kind === "mobi"
      ? mobiToDraft(bytes)
      : kind === "pdf"
        ? await pdfToDraft(bytes)
        : kind === "fb2"
          ? fb2ToDraft(bytes, /\.zip$/i.test(name))
          : kind === "html"
            ? htmlToDraft(bytes)
            : textToDraft(bytes);
  if (!draft.title) draft.title = stem;
  if (!draft.chapters.length) throw new BookError("no-text");
  return pack(draft);
}
