// DRM, checked against random sessions. Magpie's promise (CLAUDE.md, ADR 0006):
// a book locked by the store that sold it is let in byte for byte and never
// decrypted, fixed, edited, converted or sent. fast-check makes up sequences
// of what a person can do (edit, accept, choose a cover, keep styling, tag,
// remove, restore, undo, look up, sort, send to Kindle, Apple Books or a Kobo,
// preview, import again, empty Removed, quit and reopen) on a Library holding
// locked books of every kind beside unlocked ones, and checks the rules below
// after every step. When it finds a sequence that breaks one, it shrinks it to
// the shortest it can. The skill verify-drm explains how to read a failure.
//
// DRM_RUNS sets how many sessions (25 here, more in the nightly run);
// DRM_SEED replays one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { strFromU8, unzipSync } from "fflate";
import { createCore, type Core, type Host } from "../src/index.ts";
import { UserError } from "../src/errors.ts";
import { nodeHost } from "../../cli/src/node-host.ts";
import { epub, jpeg, makeCalibre, page } from "./fixtures.ts";

/** Words only the locked books' pages hold. If they turn up in anything Magpie writes outside a locked book's own file, the text got out. */
const SECRET = "only-the-store-may-read-this";

const encryption = (algorithm: string) =>
  `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${algorithm}"/><CipherData><CipherReference URI="ch1.xhtml"/></CipherData></EncryptedData></encryption>`;

const lockedEpub = (n: number, title: string, extra: Record<string, string>) =>
  epub({
    opfMeta: `<dc:identifier id="id">urn:uuid:locked-${n}</dc:identifier><dc:title>${title}</dc:title><dc:creator>Jane Austen</dc:creator><dc:language>en</dc:language>`,
    pages: { "title.xhtml": page(`<p>${title}</p>`), "ch1.xhtml": page(`<h2>Chapter 1</h2><p>${SECRET}</p>`) },
    extra,
  });

/** A Kindle file the store locked: the fixture with the encryption field of its first record's header set. */
function lockedAzw3() {
  const b = new Uint8Array(readFileSync(join(import.meta.dirname, "books", "pride.azw3")));
  const rec0 = (b[78] << 24) | (b[79] << 16) | (b[80] << 8) | b[81];
  b[rec0 + 13] = 2;
  return b;
}

/** Every kind of lock Magpie knows, and two books that aren't locked (one only has obfuscated fonts, which isn't DRM). */
const FILES: Record<string, { bytes: Uint8Array; locked: boolean }> = {
  "adobe.epub": {
    bytes: lockedEpub(1, "Lady Susan", {
      "META-INF/encryption.xml": encryption("http://www.w3.org/2001/04/xmlenc#aes128-cbc"),
      "META-INF/rights.xml": "<rights/>",
    }),
    locked: true,
  },
  "apple.epub": { bytes: lockedEpub(2, "Persuasion", { "META-INF/sinf.xml": "<fairplay/>" }), locked: true },
  "lcp.epub": { bytes: lockedEpub(3, "Sanditon", { "META-INF/license.lcpl": "{}" }), locked: true },
  "kindle.azw3": { bytes: lockedAzw3(), locked: true },
  "emma.epub": { bytes: epub(), locked: false },
  "fonts.epub": {
    bytes: epub({
      opfMeta:
        '<dc:identifier id="id">urn:uuid:7</dc:identifier><dc:title>Northanger Abbey</dc:title><dc:creator>Jane Austen</dc:creator><dc:language>en</dc:language>',
      extra: { "META-INF/encryption.xml": encryption("http://www.idpf.org/2008/embedding") },
    }),
    locked: false,
  },
};
/** A locked book that comes from Calibre, with Calibre's cover beside it. */
const CALIBRE_LOCKED = lockedEpub(4, "Mansfield Park", {
  "META-INF/rights.xml": "<rights/>",
  "META-INF/encryption.xml": encryption("http://www.w3.org/2001/04/xmlenc#aes128-cbc"),
});

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const LOCKED = new Map<string, Uint8Array>([...Object.values(FILES).filter((f) => f.locked), { bytes: CALIBRE_LOCKED }].map((f) => [sha(f.bytes), f.bytes]));

/** Open Library answers for every title, so Look Up Details would have something to put in a locked book if it tried. */
const WEB = Object.fromEntries(
  ["Lady Susan", "Persuasion", "Sanditon", "Pride and Prejudice", "Mansfield Park", "Emma", "Northanger Abbey"].map((t, i) => [
    `title=${t.replaceAll(" ", "+")}`,
    { docs: [{ key: `/works/OL${i}W`, title: t, author_name: ["Jane Austen"], first_publish_year: 1800 + i, publisher: ["Penguin"], language: ["eng"] }] },
  ]),
);

/** Records every file Magpie writes, whatever the call. */
function watching(host: Host) {
  const writes: { path: string; bytes: Uint8Array }[] = [];
  const fs = host.fs;
  return {
    writes,
    host: {
      ...host,
      fs: {
        ...fs,
        write: async (p: string, d: Uint8Array) => (writes.push({ path: p, bytes: d }), fs.write(p, d)),
        copy: async (a: string, b: string) => (writes.push({ path: b, bytes: await fs.read(a) }), fs.copy(a, b)),
      },
    } satisfies Host,
  };
}

/** What a file says about the locked books it might hold: their text, their bytes, or a book made from the Kindle one. */
function leaks(bytes: Uint8Array): string | null {
  if (LOCKED.has(sha(bytes))) return "a locked book's file";
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return new TextDecoder().decode(bytes).includes(SECRET) ? "a locked book's text" : null;
  }
  for (const [name, data] of Object.entries(entries)) {
    const text = strFromU8(data, true);
    if (text.includes(SECRET)) return `a locked book's text (in ${name})`;
    if (/\.opf$/.test(name) && /<dc:title[^>]*>Pride and Prejudice</.test(text)) return "an EPUB made from the locked Kindle book";
  }
  return null;
}

type Action =
  | { do: "edit" | "review" | "cover" | "keepStyle" | "tag" | "remove" | "restore" | "lookup" | "kindle" | "books" | "kobo" | "preview"; book: number }
  | { do: "undo" | "sort" | "import" | "purge" | "reopen" };

const ACTIONS: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    do: fc.constantFrom("edit", "review", "cover", "keepStyle", "tag", "remove", "restore", "lookup", "kindle", "books", "kobo", "preview"),
    book: fc.nat(6),
  }),
  fc.record({ do: fc.constantFrom("undo", "sort", "import", "purge", "reopen") }),
) as fc.Arbitrary<Action>;

async function session(actions: Action[]) {
  const home = mkdtempSync(join(tmpdir(), "magpie-drm-"));
  const downloads = join(home, "Downloads");
  mkdirSync(downloads);
  for (const [name, f] of Object.entries(FILES)) writeFileSync(join(downloads, name), f.bytes);
  writeFileSync(join(home, "cover.jpg"), jpeg(1400, 2100));
  makeCalibre(join(home, "Calibre"), [{ title: "Mansfield Park", authors: ["Jane Austen"], epub: CALIBRE_LOCKED }]);
  const kobo = join(home, "Volumes", "KOBOeReader");
  mkdirSync(join(kobo, ".kobo"), { recursive: true });
  writeFileSync(join(home, "web.json"), JSON.stringify(WEB));
  const env = {
    MAGPIE_HOME: home,
    MAGPIE_VOLUMES: join(home, "Volumes"),
    MAGPIE_OPENED: join(home, "opened.txt"),
    MAGPIE_WEB: join(home, "web.json"),
    MAGPIE_MODEL: "/no-model",
  };
  const spy = watching(nodeHost(env));
  let core: Core = createCore(spy.host);
  await core.call("settings.set", { kindleAddress: "me@kindle.com" });
  await core.call("books.import", { paths: [downloads] });
  await core.call("calibre.import", { path: join(home, "Calibre") });
  await core.idle();

  // How each locked book looked when it came in. Details never change after that.
  const first = new Map<string, string>();
  for (const b of await core.call("books.list", { state: "locked" })) {
    const d = await core.call("books.get", { id: b.id });
    first.set(sha(readFileSync(d.original)), JSON.stringify([d.title, d.authors, d.year ?? null, d.description ?? null, d.plan]));
  }
  assert.equal(first.size, LOCKED.size, "every locked book comes in as locked");

  const root = join(home, "Books/Magpie");
  const ids = async () => [...(await core.call("books.list")), ...(await core.call("books.list", { removed: true }))].map((b) => b.id).sort((a, b) => a - b);

  const broken: string[] = [];
  const check = async (step: string) => {
    for (const id of await ids()) {
      const d = await core.call("books.get", { id });
      const hash = sha(readFileSync(d.original));
      if (!LOCKED.has(hash)) {
        if (d.state === "locked") broken.push(`${step}: ${d.title}, which isn't locked, is listed as locked`);
        continue;
      }
      const name = `${d.title} (locked)`;
      if (d.state !== "locked") broken.push(`${step}: ${name} isn't listed as locked any more`);
      if (sha(readFileSync(d.original)) !== hash) broken.push(`${step}: ${name}'s original changed`);
      if (!existsSync(d.file) || sha(readFileSync(d.file)) !== hash) broken.push(`${step}: ${name}'s book file isn't the store's file byte for byte`);
      if (d.report.changes.length) broken.push(`${step}: ${name} has fixes: ${d.report.changes.map((c) => c.fixer).join(", ")}`);
      if (JSON.stringify([d.title, d.authors, d.year ?? null, d.description ?? null, d.plan]) !== first.get(hash))
        broken.push(`${step}: ${name}'s details changed`);
    }
    // Anything written outside a locked book's own two files must hold none of it.
    const own = new Set<string>();
    for (const id of await ids()) {
      const d = await core.call("books.get", { id });
      if (d.state === "locked") own.add(d.file).add(d.original);
    }
    for (const w of spy.writes.splice(0)) {
      if (own.has(w.path) || (w.path.startsWith(join(root, "originals")) && LOCKED.has(sha(w.bytes)))) continue;
      const what = leaks(w.bytes);
      if (what) broken.push(`${step}: ${what} was written to ${w.path.replace(home, "~")}`);
    }
  };

  await check("import");
  for (const [i, a] of actions.entries()) {
    const all = await ids();
    const id = "book" in a ? all[a.book % all.length] : -1;
    const step = `step ${i + 1} (${a.do}${id > 0 ? ` ${(await core.call("books.get", { id }).catch(() => null))?.title}` : ""})`;
    try {
      switch (a.do) {
        case "edit":
          await core.call("books.edit", { id, patch: { title: "A New Title", year: 1999 } });
          break;
        case "review":
          await core.call("books.review", { decisions: [{ id, accept: { year: 1816, publisher: "Penguin" }, dismiss: ["description"] }] });
          break;
        case "cover":
          await core.call("books.setCover", { id, path: join(home, "cover.jpg") });
          break;
        case "keepStyle":
          await core.call("books.keepStyle", { ids: [id], keep: true });
          break;
        case "tag":
          await core.call("books.tag", { ids: [id], add: ["Regency"] });
          break;
        case "remove":
          await core.call("books.remove", { ids: [id] });
          break;
        case "restore":
          await core.call("books.restore", { ids: [id] });
          break;
        case "lookup":
          await core.call("books.lookup", { ids: [id] });
          break;
        case "kindle":
          await core.call("send.kindle", { ids: [id] });
          break;
        case "books":
          await core.call("send.books", { ids: [id], again: true });
          break;
        case "kobo":
          await core.call("send.kobo", { ids: [id], device: kobo });
          break;
        case "preview":
          await core.call("books.preview", { id });
          await core.call("books.preview", { id, original: true });
          break;
        case "undo":
          await core.call("history.undo");
          break;
        case "sort":
          await core.call("library.organize", { again: true });
          break;
        case "import":
          await core.call("books.import", { paths: [downloads] });
          break;
        case "purge":
          await core.call("books.purge");
          break;
        case "reopen":
          await core.close();
          core = createCore(spy.host);
          await core.call("app.state");
          break;
      }
    } catch (e) {
      // Refusing is fine, in a sentence. A raw exception is a bug wherever it comes from.
      if (!(e instanceof UserError)) broken.push(`${step}: failed with "${e instanceof Error ? e.message : e}" instead of a sentence`);
    }
    await core.idle();
    await check(step);
    if (broken.length) break;
  }
  await core.close();
  return broken;
}

test("whatever a person does, a locked book stays the store's file byte for byte, keeps its details, and none of it is written anywhere else", async () => {
  const runs = Number(process.env.DRM_RUNS ?? 25);
  const seed = process.env.DRM_SEED ? Number(process.env.DRM_SEED) : undefined;
  await fc.assert(
    fc.asyncProperty(fc.array(ACTIONS, { minLength: 1, maxLength: 12 }), async (actions) => {
      const broken = await session(actions);
      assert.deepEqual(broken, [], `${JSON.stringify(actions)}\n${broken.join("\n")}`);
    }),
    { numRuns: runs, seed, includeErrorInReport: true },
  );
});
