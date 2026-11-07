// Kept apart from info.ts so the window can use it without bundling the core.

import type { InfoPatch, Suggestion } from "./info.ts";

/** Suggestions at least this sure start ticked on the review sheet, and Fix accepts them. Below it, a person looks first. */
export const SURE = 0.8;

/** The details a set of accepted suggestions amounts to. The window and `magpie mcp` both use this. */
export function patchFor(accepted: Suggestion[]): InfoPatch {
  const out: InfoPatch = {};
  for (const s of accepted) {
    if (s.field === "authors") out.authors = s.value.split(/\s+(?:&|and)\s+/);
    else if (s.field === "year") out.year = Number(s.value);
    else if (s.field === "cover") out.cover = s.value;
    else if (s.field === "series") {
      // "Red Rising · 5": the name and its number go in together.
      const m = s.value.match(/^(.*) · (\d+(?:\.\d+)?)$/);
      out.series = m ? m[1] : s.value;
      if (m) out.seriesIndex = Number(m[2]);
    } else out[s.field] = s.value;
  }
  return out;
}

/** "author" for authors, the field name otherwise: how a suggestion's field reads in a sentence. */
export const fieldWord = (f: Suggestion["field"]) => (f === "authors" ? "author" : f);
