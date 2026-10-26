// Kept apart from info.ts so the window can use it without bundling the core.

import type { InfoPatch, Suggestion } from "./info.ts";

/** The details a set of accepted suggestions amounts to. The window and `magpie mcp` both use this. */
export function patchFor(accepted: Suggestion[]): InfoPatch {
  const out: InfoPatch = {};
  for (const s of accepted) {
    if (s.field === "authors") out.authors = s.value.split(/\s+(?:&|and)\s+/);
    else if (s.field === "year") out.year = Number(s.value);
    else out[s.field] = s.value;
  }
  return out;
}

/** "author" for authors, the field name otherwise: how a suggestion's field reads in a sentence. */
export const fieldWord = (f: Suggestion["field"]) => (f === "authors" ? "author" : f);
