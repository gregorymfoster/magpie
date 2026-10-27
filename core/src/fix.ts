// Fixing a book: original bytes plus a FixPlan in, fixed bytes plus a
// FixReport out. The original is never changed, and the same original with
// the same plan always gives the same bytes, so a plan is also the undo record
// and a book can be re-fixed whenever the fixers improve.
//
// Order matters: the wrapper has to be readable before anything else can be
// found, and pages have to parse before the manifest and metadata fixers read them.

import { Book } from "./epub.ts";
import { container } from "./fixers/container.ts";
import { xhtml } from "./fixers/xhtml.ts";
import { manifest } from "./fixers/manifest.ts";
import { cover, putCover, type CoverFrom } from "./fixers/cover.ts";
import { makeCover } from "./covers/make.ts";
import { metadata } from "./fixers/metadata.ts";
import { toc } from "./fixers/toc.ts";
import { layout } from "./fixers/layout.ts";
import type { Change, Fixer } from "./fixers/types.ts";
import { fieldWord, patchFor } from "./suggestions.ts";
import { checkBook, type Todo } from "./checks.ts";
import { coverImage, readInfo, suggest, writeInfo, type BookInfo, type InfoPatch, type Suggestion } from "./info.ts";

// Layout runs before the contents fixer so chapter titles it turns into headings can be found.
export const FIXERS: Fixer[] = [container, xhtml, manifest, cover, layout, metadata, toc];

/** Bump when a fixer changes what it writes, so the Library knows which books to re-fix. */
export const ENGINE = 4;

export interface FixPlan {
  engine: number;
  /** Values a person accepted on the review sheet, or brought over from Calibre. Applied after the fixers. */
  info: InfoPatch;
  /** Suggestions a person turned down: the book keeps what it says. */
  dismissed?: Suggestion["field"][];
  /** What a catalog lookup (Look Up Details) found, waiting for review like the book's own suggestions. */
  found?: Suggestion[];
  /** The catalog record a lookup matched, kept for later use (sorting by year written, tags). Never written into the book. */
  catalog?: CatalogRecord;
  /**
   * A cover put into the book: one a person chose, or Calibre's when the book had none. `file` is relative to the Library.
   * A book with no cover and none chosen gets one made from its title and author (covers/make.ts).
   */
  cover?: { file: string; from: CoverFrom };
  /** "Keep the book's own styling": skip the layout fixer and leave the publisher's design as it is. */
  keepStyle?: boolean;
  /** Pinned stand-ins for a fresh uuid and today's date (see Book.stamp). */
  stamp: { uuid: string; modified: string };
}

export interface CatalogRecord {
  source: "openlibrary";
  /** "/works/OL16489877W" */
  key: string;
  /** The year the work was first published, which the book's own date (usually the edition's) often isn't. */
  firstYear?: number;
  subjects: string[];
  /** When it was looked up. */
  at: string;
}

export interface FixReport {
  /** What the fixers changed, in reader language. */
  changes: Change[];
  /** Guesses waiting for a person. Fields the plan already sets are left out. */
  suggestions: Suggestion[];
  /** Fixers that threw. The book is still built with the other fixes applied. */
  errors: { fixer: string; error: string }[];
  /** What still stands between the book and Clean, besides suggestions (checks.ts). Missing in reports from before engine 2. */
  todos?: Todo[];
}

export interface Fixed {
  bytes: Uint8Array;
  info: BookInfo;
  /** `made` when Magpie drew it because the book had none. */
  cover: { bytes: Uint8Array; mediaType: string; made?: true } | null;
  report: FixReport;
}

export function newPlan(stamp: FixPlan["stamp"], info: InfoPatch = {}): FixPlan {
  return { engine: ENGINE, info, stamp };
}

/** Files a plan points to, read by whoever holds them (the Library), so fix() stays pure. */
export interface FixAssets {
  cover?: { bytes: Uint8Array; mediaType: string };
}

/** Throws BookError when the file isn't an EPUB at all. */
export function fix(original: Uint8Array, plan: FixPlan, assets: FixAssets = {}): Fixed {
  const book = Book.load(original);
  book.stamp = plan.stamp;
  const changes: Change[] = [];
  const errors: FixReport["errors"] = [];
  for (const f of FIXERS) {
    if (f === layout && plan.keepStyle) continue;
    try {
      // A chosen cover goes in before the cover fixer, which then finds it declared.
      if (f === cover && plan.cover && assets.cover) changes.push(...putCover(book, assets.cover, plan.cover.from));
      changes.push(...f.run(book));
    } catch (e) {
      errors.push({ fixer: f.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  // The book's own pages first; a looked-up value only where it's surer or the pages had nothing.
  const merged = suggest(book);
  for (const f of plan.found ?? []) {
    const i = merged.findIndex((s) => s.field === f.field);
    if (i === -1) merged.push(f);
    else if (f.confidence > merged[i].confidence) merged[i] = f;
  }
  const suggestions = merged.filter((s) => plan.info[s.field] === undefined && !plan.dismissed?.includes(s.field));
  if (Object.keys(plan.info).length) writeInfo(book, plan.info);
  let info = readInfo(book);
  let made: true | undefined;
  // Made after the details are written, so an edited title shows on the cover too.
  if (book.opfPath && !coverImage(book)) {
    try {
      changes.push(...putCover(book, { bytes: makeCover(info.title, info.authors), mediaType: "image/png" }, "magpie"));
      info = readInfo(book);
      made = true;
    } catch (e) {
      errors.push({ fixer: "cover", error: e instanceof Error ? e.message : String(e) });
    }
  }
  const c = coverImage(book);
  return {
    bytes: book.save(),
    info,
    cover: c && { bytes: book.files.get(c.path)!, mediaType: c.mediaType, made },
    report: { changes, suggestions, errors, todos: checkBook(book, info, errors, plan.keepStyle) },
  };
}

/** Turn accepted suggestions into plan values. */
export const accept = patchFor;

/**
 * Fix and accept every suggestion: what the CLI's --accept and the bench do,
 * standing in for a person who ticks everything on the review sheet.
 */
export function fixAndAccept(original: Uint8Array, stamp: FixPlan["stamp"] = new Book().stamp): Fixed {
  const first = fix(original, newPlan(stamp));
  if (!first.report.suggestions.length) return first;
  const second = fix(original, newPlan(stamp, accept(first.report.suggestions)));
  // Report what the person accepted as changes, so nothing is silent.
  for (const s of first.report.suggestions) {
    second.report.changes.push({
      fixer: "metadata",
      message: s.current
        ? `Replaced the ${label(s.field)} "${s.current}" with "${s.value}", read from ${s.source}.`
        : `Added the missing ${label(s.field)} "${s.value}", read from ${s.source}.`,
      source: s.source,
    });
  }
  return second;
}

const label = fieldWord;

export type { Change, Fixer } from "./fixers/types.ts";
