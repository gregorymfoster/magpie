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
