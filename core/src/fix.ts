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
import { cover } from "./fixers/cover.ts";
import { metadata } from "./fixers/metadata.ts";
import { toc } from "./fixers/toc.ts";
import type { Change, Fixer } from "./fixers/types.ts";
import { coverImage, readInfo, suggest, writeInfo, type BookInfo, type InfoPatch, type Suggestion } from "./info.ts";

export const FIXERS: Fixer[] = [container, xhtml, manifest, cover, metadata, toc];

/** Bump when a fixer changes what it writes, so the Library knows which books to re-fix. */
export const ENGINE = 1;

export interface FixPlan {
  engine: number;
  /** Values a person accepted on the review sheet, or brought over from Calibre. Applied after the fixers. */
  info: InfoPatch;
  /** Suggestions a person turned down: the book keeps what it says. */
  dismissed?: Suggestion["field"][];
  /** Pinned stand-ins for a fresh uuid and today's date (see Book.stamp). */
  stamp: { uuid: string; modified: string };
}

export interface FixReport {
  /** What the fixers changed, in reader language. */
  changes: Change[];
  /** Guesses waiting for a person. Fields the plan already sets are left out. */
  suggestions: Suggestion[];
  /** Fixers that threw. The book is still built with the other fixes applied. */
  errors: { fixer: string; error: string }[];
}

export interface Fixed {
  bytes: Uint8Array;
  info: BookInfo;
  cover: { bytes: Uint8Array; mediaType: string } | null;
  report: FixReport;
}

export function newPlan(stamp: FixPlan["stamp"], info: InfoPatch = {}): FixPlan {
  return { engine: ENGINE, info, stamp };
}

/** Throws BookError when the file isn't an EPUB at all. */
export function fix(original: Uint8Array, plan: FixPlan): Fixed {
  const book = Book.load(original);
  book.stamp = plan.stamp;
  const changes: Change[] = [];
  const errors: FixReport["errors"] = [];
  for (const f of FIXERS) {
    try {
      changes.push(...f.run(book));
    } catch (e) {
      errors.push({ fixer: f.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const suggestions = suggest(book).filter((s) => plan.info[s.field] === undefined && !plan.dismissed?.includes(s.field));
  if (Object.keys(plan.info).length) writeInfo(book, plan.info);
  const c = coverImage(book);
  return {
    bytes: book.save(),
    info: readInfo(book),
    cover: c && { bytes: book.files.get(c.path)!, mediaType: c.mediaType },
    report: { changes, suggestions, errors },
  };
}

/** Turn accepted suggestions into plan values. */
export function accept(suggestions: Suggestion[]): InfoPatch {
  const patch: InfoPatch = {};
  for (const s of suggestions) {
    if (s.field === "authors") patch.authors = s.value.split(/\s+(?:&|and)\s+/);
    else patch[s.field] = s.value;
  }
  return patch;
}

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

const label = (f: Suggestion["field"]) => (f === "authors" ? "author" : f);

export type { Change, Fixer } from "./fixers/types.ts";
