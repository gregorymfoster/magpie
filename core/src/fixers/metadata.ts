// The package metadata a reader never sees but Kindle insists on: a language,
// an identifier the package actually points at, and EPUB 3's last-modified
// date. Title and author are not fixed here. Changing those changes what a
// person sees, so they go to the review sheet as Suggestions (see info.ts).

import { textOf, type Book } from "../epub.ts";
import { guessLanguage } from "../identify/rules.ts";
import type { Change, Fixer } from "./types.ts";

const TAG = /<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/gi;

export const metadata: Fixer = {
  id: "metadata",
  title: "Fill in language and identifiers",
  run(book: Book): Change[] {
    if (!book.opfPath) return [];
    const opf = book.opf();
    const changes: Change[] = [];
    const say = (message: string, source?: string) => changes.push({ fixer: "metadata", message, source });

    // Markup that leaked into a field ("<b>Jane Austen</b>") shows up as literal tags on every reader.
    let stripped = 0;
    for (const el of ["title", "creator", "publisher"].flatMap((n) => opf.dc(n))) {
      const text = textOf(el);
      if (!text.match(TAG)) continue;
      const plain = text.replace(TAG, " ").replace(/\s+/g, " ").trim();
      if (plain) {
        el.textContent = plain;
        stripped++;
      }
    }
    if (stripped) say("Removed HTML tags from the title and author fields, which readers would show as text.");

    if (!textOf(opf.dc("language")[0])) {
      const g = guessLanguage(book, opf);
      opf.addDc("language", g.value);
      say(`Set the language to "${g.value}" (from ${g.source}). Kindle rejects books without one.`, g.source);
    }

    const uidRef = opf.pkg.getAttribute("unique-identifier");
    const ids = opf.dc("identifier");
    if (!uidRef || !ids.some((i) => i.getAttribute("id") === uidRef)) {
      let target = ids.find((i) => /uuid|isbn/i.test(textOf(i))) ?? ids[0];
      if (!target) target = opf.addDc("identifier", `urn:uuid:${book.stamp.uuid}`);
      if (!target.getAttribute("id")) target.setAttribute("id", opf.uniqueId(uidRef || "bookid"));
      opf.pkg.setAttribute("unique-identifier", target.getAttribute("id")!);
      say(ids.length ? "Pointed the package at the book's identifier, which it had misnamed." : "Added a unique identifier.");
    }

    if (opf.epub3 && !opf.metas().some((m) => m.getAttribute("property") === "dcterms:modified" && !m.getAttribute("refines"))) {
      opf.addMeta({ property: "dcterms:modified" }, book.stamp.modified);
      say("Added the last-modified date EPUB 3 requires.");
    }

    opf.save();
    return changes;
  },
};
