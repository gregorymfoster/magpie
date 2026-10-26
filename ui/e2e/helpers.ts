import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { epub, page as xhtml } from "../../core/test/fixtures.ts";

/** Write EPUBs to a temp folder and return their paths. */
export function books(spec: Record<string, Uint8Array>) {
  const dir = mkdtempSync(join(tmpdir(), "magpie-e2e-books-"));
  return Object.entries(spec).map(([name, bytes]) => {
    writeFileSync(join(dir, name), bytes);
    return join(dir, name);
  });
}

export const emma = () => epub();
export const unknownAuthor = () =>
  epub({ opfMeta: '<dc:identifier id="id">urn:uuid:9</dc:identifier><dc:title>Emma</dc:title><dc:creator>Unknown</dc:creator><dc:language>en</dc:language>' });

/** Call the core directly, to set up state without clicking. */
export async function call(page: Page, command: string, args?: unknown) {
  const r = await page.request.post("/api/call", { data: { command, args } });
  const body = await r.json();
  if (body.error) throw new Error(body.error);
  return body.result;
}

/** Start each test from an empty Library. */
export async function reset(page: Page) {
  await page.goto("/");
  const ids = (await call(page, "books.list")).map((b: { id: number }) => b.id);
  if (ids.length) await call(page, "books.remove", { ids });
  await call(page, "books.purge");
  await call(page, "settings.set", { kindleAddress: "" });
  await page.reload();
}

/** A shelf of real-looking books for screenshots; the fourth has "Unknown" as its author. */
export const CLASSICS: [string, string][] = [
  ["Pride and Prejudice", "Jane Austen"],
  ["Middlemarch", "George Eliot"],
  ["Moby-Dick", "Herman Melville"],
  ["Jane Eyre", "Charlotte Brontë"],
  ["Great Expectations", "Charles Dickens"],
  ["The Age of Innocence", "Edith Wharton"],
  ["Anna Karenina", "Leo Tolstoy"],
  ["Persuasion", "Jane Austen"],
  ["Wuthering Heights", "Emily Brontë"],
  ["The Odyssey", "Homer"],
  ["Little Women", "Louisa May Alcott"],
  ["Frankenstein", "Mary Shelley"],
  ["Bleak House", "Charles Dickens"],
  ["The Portrait of a Lady", "Henry James"],
  ["Dracula", "Bram Stoker"],
];
export const classic = ([title, author]: [string, string], i: number) =>
  epub({
    opfMeta: `<dc:identifier id="id">urn:uuid:c${i}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${i === 3 ? "Unknown" : author}</dc:creator><dc:language>en</dc:language>`,
    pages: { "title.xhtml": xhtml(`<p>Title: ${title}</p><p>Author: ${author}</p>`), "ch1.xhtml": xhtml("<h2>Chapter 1</h2><p>It begins.</p>") },
  });


/** All the classics, as files in a temp folder. */
export const classicFiles = () => books(Object.fromEntries(CLASSICS.map((c, i) => [`${c[0].replace(/\W+/g, "-")}.epub`, classic(c, i)])));

/** A book with real chapters to page through: enough text for several screens, a picture and its own stylesheet. */
export const longBook = () => {
  const para = [
    "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
    "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
    "“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”",
    "Mr. Bennet replied that he had not. “But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.”",
  ];
  const text = (n: number) => Array.from({ length: n }, (_, i) => `<p>${para[i % para.length]}</p>`).join("");
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" fill="#7a2e2a"/><circle cx="150" cy="100" r="60" fill="#e8d9b0"/></svg>'; // ratchet-ok
  const head = '<link rel="stylesheet" href="style.css"/>';
  return epub({
    opfMeta:
      '<dc:identifier id="id">urn:uuid:pp</dc:identifier><dc:title>Pride and Prejudice</dc:title><dc:creator>Jane Austen</dc:creator><dc:language>en</dc:language>',
    pages: {
      "ch1.xhtml": xhtml(`<h2>Chapter 1</h2>${text(6)}<div class="fig"><img src="plate.svg" alt="A plate"/></div>${text(18)}`).replace("<title>t</title>", head),
      "ch2.xhtml": xhtml(`<h2>Chapter 2</h2>${text(16)}`).replace("<title>t</title>", head),
    },
    manifest: '<item id="css" href="style.css" media-type="text/css"/><item id="plate" href="plate.svg" media-type="image/svg+xml"/>',
    extra: { "style.css": "h2 { text-align: center; font-weight: normal; margin: 2em 0 1em } p { margin: 0; text-indent: 1.5em } .fig { text-align: center; margin: 1em 0 }", "plate.svg": svg },
  });
};
