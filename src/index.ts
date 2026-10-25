// Magpie's fixer pipeline: load an EPUB, run each fixer in order, save.
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

export const FIXERS: Fixer[] = [container, xhtml, manifest, cover, metadata, toc];

export interface FixResult {
  bytes: Uint8Array;
  changes: Change[];
  /** Fixers that threw. The book is still saved with the other fixes applied. */
  errors: { fixer: string; error: string }[];
}

export function fixEpub(input: Uint8Array, fixers: Fixer[] = FIXERS): FixResult {
  const book = Book.load(input);
  const changes: Change[] = [];
  const errors: FixResult["errors"] = [];
  for (const f of fixers) {
    try {
      changes.push(...f.run(book));
    } catch (e) {
      errors.push({ fixer: f.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { bytes: book.save(), changes, errors };
}

export { Book } from "./epub.ts";
export type { Change, Fixer } from "./fixers/types.ts";
