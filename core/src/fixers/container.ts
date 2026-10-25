// The zip wrapper: mimetype entry and META-INF/container.xml.
// Send to Kindle and most readers refuse a file whose wrapper is wrong before
// they look at anything inside it.

import { CONTAINER_PATH, type Book } from "../epub.ts";
import type { Change, Fixer } from "./types.ts";

const MIMETYPE = "application/epub+zip";

export const container: Fixer = {
  id: "container",
  title: "Repair the EPUB wrapper",
  run(book: Book): Change[] {
    const changes: Change[] = [];
    const say = (message: string, path?: string) => changes.push({ fixer: "container", message, path });

    const first = book.entries.find((e) => !e.name.endsWith("/"));
    const mt = book.files.get("mimetype");
    if (!mt) say("Added the missing mimetype entry that marks the file as an EPUB.", "mimetype");
    else if (new TextDecoder().decode(mt) !== MIMETYPE) say("Corrected the mimetype entry, which had extra characters.", "mimetype");
    else if (first?.name !== "mimetype") say("Moved the mimetype entry to the front of the zip, where readers expect it.", "mimetype");
    else if (first.compression !== 0) say("Stored the mimetype entry uncompressed, as the EPUB format requires.", "mimetype");
    // Book.save() always writes a correct mimetype entry; this keeps the in-memory copy honest.
    book.files.set("mimetype", new TextEncoder().encode(MIMETYPE));

    if (!book.opfPath) {
      const opfs = [...book.files.keys()].filter((p) => p.toLowerCase().endsWith(".opf"));
      // Prefer the shallowest package document if there are several.
      opfs.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
      if (opfs.length) {
        const had = book.has(CONTAINER_PATH);
        book.setText(
          CONTAINER_PATH,
          `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n` +
            `  <rootfiles>\n    <rootfile full-path="${opfs[0]}" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>\n`,
        );
        book.opfPath = opfs[0];
        say(
          had
            ? `Pointed META-INF/container.xml at the book's real package file (${opfs[0]}).`
            : "Recreated META-INF/container.xml, which tells readers where the book starts.",
          CONTAINER_PATH,
        );
      }
    }
    return changes;
  },
};
