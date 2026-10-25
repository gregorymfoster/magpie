import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { epub } from "../../core/test/fixtures.ts";

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
