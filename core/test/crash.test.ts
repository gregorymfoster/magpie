// Crash safety, checked at every write. A person's session (add books, look
// them up, accept, edit, choose a cover, sort, remove, undo, empty Removed) is
// run once to count the writes it makes to disk and to the database. Then it
// is run again for every one of those writes, with the Mac losing power just
// before it: that write and everything after it never happen. Magpie is then
// opened again, the way it would be after a restart, and the Library is
// checked against the rules below. The skill verify-crash-safety explains how
// to read a failure and keep this true to the code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCore, type Core, type Db, type Host } from "../src/index.ts";
import { Book } from "../src/epub.ts";
import { readInfo } from "../src/info.ts";
import { nodeHost } from "../../cli/src/node-host.ts";
import { epub, jpeg } from "./fixtures.ts";

/** Thrown by every host call once the power is gone. */
class PowerCut extends Error {}

// A dead session's background work keeps failing until it gives up; that's the point.
process.on("unhandledRejection", (e) => {
  if (!(e instanceof PowerCut) && !/unexpected/i.test(String(e))) throw e;
});

/**
 * A host that loses power just before its `at`th write. Writes are the calls
 * that change the disk or the database; each is all or nothing, as the host
 * contract promises (fs.write renames a whole temp file; each SQL statement or
 * batch commits on its own). After the cut, every call fails.
 */
function losesPower(host: Host, at: number) {
  let writes = 0;
  let dead = false;
  const write = () => {
    if (dead || ++writes === at) {
      dead = true;
      throw new PowerCut();
    }
  };
  const read = () => {
    if (dead) throw new PowerCut();
  };
  const fs = host.fs;
  const wrapDb = (db: Db): Db => ({
    all: async (sql, p) => (read(), db.all(sql, p)),
    run: async (sql, p) => (/^\s*(select|pragma\s+\w+\s*$)/i.test(sql) ? read() : write(), db.run(sql, p)),
    batch: async (s) => (write(), db.batch(s)),
    exec: async (sql) => (write(), db.exec(sql)),
    close: () => db.close(),
  });
  const wrapped: Host = {
    ...host,
    fs: {
      read: async (p) => (read(), fs.read(p)),
      exists: async (p) => (read(), fs.exists(p)),
      list: async (p) => (read(), fs.list(p)),
      free: async (p) => (read(), fs.free(p)),
      write: async (p, d) => (write(), fs.write(p, d)),
      copy: async (a, b) => (write(), fs.copy(a, b)),
      mkdir: async (p) => (write(), fs.mkdir(p)),
      remove: async (p) => (write(), fs.remove(p)),
      move: async (a, b) => (write(), fs.move(a, b)),
    },
    sqlite: { open: async (p, o) => (read(), wrapDb(await host.sqlite.open(p, o))) },
    open: async (p) => (write(), host.open(p)),
    books: async (p) => (write(), host.books(p)),
    mail: async (m) => (write(), host.mail(m)),
  };
  return { host: wrapped, writes: () => writes, dead: () => dead };
}

const WEB = {
  "title=Emma&author=Jane+Austen": {
    docs: [{ key: "/works/OL66562W", title: "Emma", author_name: ["Jane Austen"], first_publish_year: 1815, language: ["eng"], subject: ["Fiction"] }],
  },
  "/works/OL66562W.json": { description: "Emma Woodhouse, handsome, clever, and rich, meddles in the love lives of her friends." },
};

function home() {
  const dir = mkdtempSync(join(tmpdir(), "magpie-crash-"));
  mkdirSync(join(dir, "Downloads"));
  writeFileSync(join(dir, "web.json"), JSON.stringify(WEB));
  writeFileSync(join(dir, "Downloads/emma.epub"), epub());
  writeFileSync(
    join(dir, "Downloads/dune.epub"),
    epub({
      opfMeta:
        '<dc:identifier id="id">urn:uuid:dune</dc:identifier><dc:title>Dune</dc:title><dc:creator>Frank Herbert</dc:creator><dc:language>en</dc:language><dc:subject>Science fiction</dc:subject>',
    }),
  );
  writeFileSync(join(dir, "Downloads/cover.jpg"), jpeg(1400, 2100));
  return dir;
}

const env = (dir: string) => ({ MAGPIE_HOME: dir, MAGPIE_WEB: join(dir, "web.json"), MAGPIE_MODEL: "/no-model", MAGPIE_OPENED: join(dir, "opened.txt") });

const id = async (core: Core, title: string) => (await core.call("books.list")).find((b) => b.title.startsWith(title))?.id ?? -1;

/** What a person does, one step at a time. Each step's name is what it promises once it returns. */
const SESSION: [string, (core: Core, dir: string) => Promise<unknown>][] = [
  ["settings", (c) => c.call("settings.set", { organize: false })],
  ["import", async (c, d) => (await c.call("books.import", { paths: [join(d, "Downloads/emma.epub"), join(d, "Downloads/dune.epub")] }), c.idle())],
  ["lookup", async (c) => (await c.call("books.lookup", { ids: [await id(c, "Emma")] }), c.idle())],
  [
    "review",
    async (c) => {
      const emma = await c.call("books.get", { id: await id(c, "Emma") });
      return c.call("books.review", { decisions: [{ id: emma.id, accept: { year: 1815 }, dismiss: ["description"] }] });
    },
  ],
  ["edit", async (c) => c.call("books.edit", { id: await id(c, "Emma"), patch: { title: "Emma, a Novel" } })],
  ["cover", async (c, d) => c.call("books.setCover", { id: await id(c, "Dune"), path: join(d, "Downloads/cover.jpg") })],
  ["sort", async (c) => (await c.call("library.organize", { again: true }), c.idle())],
  ["remove", async (c) => c.call("books.remove", { ids: [await id(c, "Dune")] })],
  ["undo remove", (c) => c.call("history.undo")],
  ["undo sort", (c) => c.call("history.undo")],
  ["undo cover", (c) => c.call("history.undo")],
  ["remove again", async (c) => c.call("books.remove", { ids: [await id(c, "Dune")] })],
  ["empty Removed", (c) => c.call("books.purge")],
];

/** What a person can see of the Library, to compare runs: each book's details and shelves, and what Undo would do. */
async function view(core: Core) {
  const live = await core.call("books.list");
  const removed = await core.call("books.list", { removed: true }).catch(() => []);
  const books = [];
  for (const b of [...live, ...removed].sort((x, y) => x.title.localeCompare(y.title))) {
    const d = await core.call("books.get", { id: b.id });
    books.push({ title: d.title, year: d.year ?? null, removed: !!d.removedAt, tags: d.tags.map((t) => t.name).sort(), cover: d.plan.cover?.from ?? null });
  }
  return { books, undo: (await core.call("app.state")).undo ?? null };
}

/** The rules every Library must keep after a restart, whatever happened before it. */
function checkFiles(dir: string): string[] {
  const root = join(dir, "Books/Magpie");
  const db = new DatabaseSync(join(root, "library.db"), { readOnly: true });
  const broken: string[] = [];
  const used = new Set<string>();
  try {
    for (const r of db.prepare("SELECT * FROM books").all() as Record<string, string | number | null>[]) {
      const name = `${r.title} (${r.removed_at ? "in Removed" : "in the Library"})`;
      for (const k of ["file", "original", "cover"]) if (r[k]) used.add(r[k] as string);
      const original = join(root, r.original as string);
      if (!existsSync(original)) broken.push(`${name}: its original ${r.original} is missing`);
      else if (createHash("sha256").update(readFileSync(original)).digest("hex") !== r.hash) broken.push(`${name}: its original ${r.original} changed`);
      const file = join(root, r.file as string);
      if (!existsSync(file)) broken.push(`${name}: its book ${r.file} is missing`);
      else if (r.state !== "locked")
        try {
          const inside = readInfo(Book.load(readFileSync(file))).title;
          if (inside !== r.title) broken.push(`${name}: its book ${r.file} says its title is ${inside}`);
        } catch {
          broken.push(`${name}: its book ${r.file} won't open`);
        }
      if (r.cover && !existsSync(join(root, r.cover as string))) broken.push(`${name}: its cover ${r.cover} is missing`);
    }
  } finally {
    db.close();
  }
  // Files a change stopped using are cleared away. A chosen cover stays: the plans in Undo may point to it.
  for (const sub of ["books", "covers"])
    for (const f of readdirSync(join(root, sub), { recursive: true, withFileTypes: true })) {
      const rel = relative(root, join(f.parentPath, f.name));
      if (f.isFile() && !rel.startsWith("covers/chosen/") && !used.has(rel)) broken.push(`${rel} is left over`);
    }
  return broken;
}

function jobs(dir: string) {
  const db = new DatabaseSync(join(dir, "Books/Magpie/library.db"), { readOnly: true });
  try {
    return db.prepare("SELECT kind, state FROM jobs").all() as { kind: string; state: string }[];
  } finally {
    db.close();
  }
}

async function reopen(dir: string) {
  const core = createCore(nodeHost(env(dir)));
  await core.call("app.state");
  await core.idle();
  return core;
}

test("a power cut at any write leaves a Library that opens, keeps every finished step, and has each step either done or not", async () => {
  // The run with no power cut: how many writes, and what a person sees after each step.
  const clean = home();
  const counter = losesPower(nodeHost(env(clean)), Infinity);
  const core = createCore(counter.host);
  const after: { name: string; jobs: number; view: Awaited<ReturnType<typeof view>> }[] = [{ name: "start", jobs: 0, view: { books: [], undo: null } }];
  for (const [name, step] of SESSION) {
    await step(core, clean);
    after.push({ name, jobs: jobs(clean).length, view: await view(core) });
  }
  await core.close();
  assert.deepEqual(checkFiles(clean), []);
  const total = counter.writes();

  const failures: string[] = [];
  const only = process.env.CRASH_AT ? [Number(process.env.CRASH_AT)] : null;
  for (let at = 1; at <= total; at++) {
    if (only && !only.includes(at)) continue;
    const dir = home();
    const cut = losesPower(nodeHost(env(dir)), at);
    const dying = createCore(cut.host);
    let reached = 0;
    for (const [, step] of SESSION) {
      try {
        await step(dying, dir);
      } catch {
        break;
      }
      if (cut.dead()) break;
      reached++;
    }
    // `reached` steps returned before the cut; the next one was under way.
    const was = `power cut before write ${at} of ${total}, during "${SESSION[reached]?.[0] ?? "after the session"}"`;
    let again: Core;
    try {
      again = await reopen(dir);
    } catch (e) {
      failures.push(`${was}: Magpie won't open the Library again (${e instanceof Error ? e.message : e})`);
      continue;
    }
    for (const b of checkFiles(dir)) failures.push(`${was}: ${b}`);
    const now = await view(again);
    const left = jobs(dir);
    for (const j of left.filter((j) => j.state !== "done" && j.state !== "cancelled"))
      failures.push(`${was}: a ${j.kind} job is still ${j.state} after a restart`);
    // Each step is all or nothing. A job (import, lookup, sort) that was queued carries on after a restart, so it ends done.
    const queued = left.length > after[reached].jobs;
    const allowed = queued ? [after[reached + 1]] : [after[reached], after[reached + 1]].filter(Boolean);
    if (!allowed.some((a) => JSON.stringify(a.view) === JSON.stringify(now)))
      failures.push(
        `${was}: the Library shows ${JSON.stringify(now)}, but should show ${allowed.map((a) => `what it did after "${a.name}" ${JSON.stringify(a.view)}`).join(" or ")}`,
      );
    await again.close();
  }
  assert.deepEqual(failures, [], `${failures.length} of ${total} power cuts left the Library broken`);
});
