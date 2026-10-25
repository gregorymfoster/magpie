import type { Book } from "../epub.ts";

/** One thing a fixer changed, written for a reader, not a developer. */
export interface Change {
  fixer: string;
  /** Plain English, e.g. "Declared the cover image so Kindle shows it." */
  message: string;
  /** The file this change touched, if any. */
  path?: string;
  /** For metadata: where a filled-in value came from. */
  source?: string;
}

export interface Fixer {
  id: string;
  /** What the fixer is for, as shown on a problem page. */
  title: string;
  run(book: Book): Change[];
}
