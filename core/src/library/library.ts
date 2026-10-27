// A Library is a folder: library.db, books/, originals/, covers/, backups/.
// Every path stored is relative, so the folder can move to another disk.
// This module is the only thing that reads or writes that folder.
//
// The model: each book is an untouched original plus a FixPlan. The book in
// books/ is always rebuilt from those two, so changing a title, accepting a
// suggestion or undoing either is "change the plan, rebuild".

import { UserError } from "../errors.ts";
import { Book, BookError } from "../epub.ts";
import { ENGINE, fix, newPlan, type CatalogRecord, type FixPlan, type FixReport } from "../fix.ts";
import { readInfo, type InfoPatch, type Suggestion } from "../info.ts";
import { ORGANIZER, readOpening, readSubjects, type Organizer } from "../organize/organize.ts";
import { join, type Db, type Host, type SqlValue } from "../host.ts";
import { bookPath, unique } from "../naming.ts";
import { MIGRATIONS } from "./schema.ts";
import { GENRES, GENRE_NAMES, KINDS, VIBES, VIBE_NAMES } from "../organize/vocabulary.ts";

/**
 * "clean": passed every check, nothing waiting. "work": Needs work, with to-dos
 * (report.todos). "review": Needs work, with suggested details waiting for a
 * person. "locked": DRM. Kept byte for byte as it came; never fixed, edited, converted or sent.
 */
export type BookState = "clean" | "work" | "review" | "locked";

/** A word a book is filed under. Magpie's own come with how sure it was and why. */
export interface Tag {
  name: string;
  /** "you": typed by a person. "calibre": brought over from Calibre. "magpie": Magpie sorted it. */
  by: "you" | "calibre" | "magpie";
  confidence?: number;
  /** For Magpie's tags: what it read, "the book's subjects" or "Magpie's model". */
  source?: string;
}

/** The sidebar's groups, each with how many books are in it. */
export interface Groups {
  shelves: { name: string; count: number; genres: { name: string; count: number }[] }[];
  vibes: { name: string; count: number }[];
  /** Tags that aren't shelves or vibes: a person's and Calibre's own. */
  tags: { name: string; count: number }[];
  /** Authors and series with at least two books. */
  authors: { name: string; count: number }[];
  series: { name: string; count: number }[];
  /** Live books Magpie hasn't sorted yet. */
  unsorted: number;
}

/** One row of the Library, as the grid and list show it. */
export interface BookSummary {
  id: number;
  title: string;
  authors: string[];
  series?: string;
  seriesIndex?: number;
  language: string;
  year?: number;
  state: BookState;
  /** Absolute path of the cover image, if the book has one. */
  cover?: string;
  size: number;
  addedAt: string;
  removedAt?: string;
  tags: Tag[];
  publisher?: string;
  /** The year the work first came out, when Look Up Details found it (the book's own year is usually the edition's). */
  firstYear?: number;
  /** How many things stand between the book and Clean: to-dos plus suggestions waiting. */
  todo: number;
}

/** Everything the inspector shows. */
export interface BookDetail extends BookSummary {
  isbn?: string;
  description?: string;
  /** Absolute path of the fixed EPUB. */
  file: string;
  /** Absolute path of the untouched original. */
  original: string;
  origin: "import" | "calibre";
  originName: string;
  report: FixReport;
  plan: FixPlan;
}

export type AddOutcome =
  | { kind: "added"; book: BookSummary; locked?: boolean }
  | { kind: "duplicate"; book: BookSummary }
  | { kind: "unreadable"; name: string; reason: BookError["code"] | "not-epub" | "missing-file" };

export interface AddSource {
  /** Absolute path of the file to bring in. It is copied, never moved. */
  path: string;
  /** What to call it in "Couldn't read …" messages; defaults to the file name. */
  name?: string;
  origin?: "import" | "calibre";
  /** Trusted details (from Calibre), applied without review. */
  info?: InfoPatch;
  /** A cover image to show when the book has none of its own (Calibre's cover.jpg). */
  cover?: string;
  /** Calibre's tags, kept as they were. */
  tags?: string[];
}

export interface ListQuery {
  /** "work" also finds books waiting for review, since those need work too. */
  state?: BookState;
  /** Matches title, author, series or tag. */
  search?: string;
  /** Books with this tag: a shelf, a genre, a vibe or any other tag. */
  tag?: string;
  author?: string;
  series?: string;
  removed?: boolean;
  sort?: "added" | "title" | "author";
}

export interface Counts {
  all: number;
  clean: number;
  work: number;
  review: number;
  removed: number;
}

export const REMOVED_DAYS = 30;

/** What a book's plan held before a lookup changed it. */
export interface LookupPrev {
  id: number;
  found?: Suggestion[];
  catalog?: CatalogRecord;
}

type Row = Record<string, SqlValue>;
interface Snapshot {
  plan: FixPlan;
  removed_at: string | null;
  /** Raw JSON. Missing in history written before tags existed. */
  tags?: string;
  tags_off?: string;
}

export class Library {
  readonly root: string;
  private db: Db;
  private host: Host;

  private constructor(host: Host, root: string, db: Db) {
    this.host = host;
    this.root = root;
    this.db = db;
  }

  /** Opens the Library at root, creating it when the folder is new. */
  static async open(host: Host, root: string): Promise<Library> {
    for (const d of ["books", "originals", "covers", "backups"]) await host.fs.mkdir(join(root, d));
    const db = await host.sqlite.open(join(root, "library.db"));
    await db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    const lib = new Library(host, root, db);
    await lib.migrate();
    await lib.purgeRemoved();
    return lib;
  }

  async close() {
    await this.db.close();
  }

  abs(rel: string) {
    return join(this.root, rel);
  }

  // ------------------------------------------------------------ books in

  async add(src: AddSource): Promise<AddOutcome> {
    const name = src.name ?? src.path.slice(src.path.lastIndexOf("/") + 1);
    if (!/\.epub$/i.test(src.path)) return { kind: "unreadable", name, reason: "not-epub" };
    if (!(await this.host.fs.exists(src.path))) return { kind: "unreadable", name, reason: "missing-file" };
    const bytes = await this.host.fs.read(src.path);
    const hash = await sha256(bytes);
    const existing = (await this.db.all("SELECT * FROM books WHERE hash = ?", [hash]))[0];
    if (existing) {
      // Bringing back a removed book restores it.
      if (existing.removed_at) await this.db.run("UPDATE books SET removed_at = NULL WHERE id = ?", [existing.id]);
      return { kind: "duplicate", book: this.summary({ ...existing, removed_at: null }) };
    }
    const now = new Date().toISOString();
    const plan = newPlan({ uuid: uuidFrom(hash), modified: now.replace(/\.\d+Z$/, "Z") }, src.info ?? {});
    let built: ReturnType<typeof fix> & { locked?: boolean };
    try {
      built = fix(bytes, plan);
    } catch (e) {
      if (e instanceof BookError && e.code === "drm") built = asLocked(bytes, src.info);
      else if (e instanceof BookError) return { kind: "unreadable", name, reason: e.code };
      else throw e;
    }
    const original = `originals/${hash}.epub`;
    await this.host.fs.write(this.abs(original), bytes);
    const file = await unique(`books/${bookPath(built.info.authors, built.info.title || stem(name))}`, (p) => this.host.fs.exists(this.abs(p)));
    await this.host.fs.write(this.abs(file), built.bytes);
    const r = await this.db.run(
      `INSERT INTO books (hash, title, authors, author_sort, series, series_index, language, publisher, year, isbn, description,
         file, original, size, state, plan, report, origin, origin_name, added_at, updated_at, tags)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        hash,
        built.info.title || stem(name),
        JSON.stringify(built.info.authors),
        authorSort(built.info.authors[0] ?? ""),
        built.info.series ?? null,
        built.info.seriesIndex ?? null,
        built.info.language,
        built.info.publisher ?? null,
        built.info.year ?? null,
        built.info.isbn ?? null,
        built.info.description ?? null,
        file,
        original,
        built.bytes.length,
        built.locked ? "locked" : stateOf(built.report),
        JSON.stringify(plan),
        JSON.stringify(built.report),
        src.origin ?? "import",
        name,
        now,
        now,
        JSON.stringify(cleanTags(src.tags ?? []).map((name): Tag => ({ name, by: "calibre" }))),
      ],
    );
    const id = r.lastId;
    const cover = await this.saveCover(id, built.cover, src.cover);
    if (cover) await this.db.run("UPDATE books SET cover = ? WHERE id = ?", [cover, id]);
    return { kind: "added", book: await this.summaryById(id), locked: built.locked };
  }

  // ------------------------------------------------------------ reading

  async list(q: ListQuery = {}): Promise<BookSummary[]> {
    const where = [q.removed ? "removed_at IS NOT NULL" : "removed_at IS NULL"];
    const params: SqlValue[] = [];
    if (q.state === "work") where.push("state IN ('work', 'review')");
    else if (q.state) {
      where.push("state = ?");
      params.push(q.state);
    }
    const order = { added: "added_at DESC, id DESC", title: "id", author: "id" }[q.sort ?? "added"];
    let books = (await this.db.all(`SELECT * FROM books WHERE ${where.join(" AND ")} ORDER BY ${order}`, params)).map((r) => this.summary(r));
    if (q.tag) books = books.filter((b) => b.tags.some((t) => t.name === q.tag));
    if (q.author) books = books.filter((b) => b.authors.includes(q.author!));
    if (q.series) books = books.filter((b) => b.series === q.series);
    // Searching and sorting happen here rather than in SQL so they read like Finder:
    // "bronte" finds Brontë, and Book 2 comes before Book 10 with "The" ignored.
    const words = fold(q.search ?? "")
      .split(" ")
      .filter(Boolean);
    if (words.length)
      books = books.filter((b) =>
        ((hay) => words.every((w) => hay.includes(w)))(fold([b.title, ...b.authors, b.series ?? "", ...b.tags.map((t) => t.name)].join(" "))),
      );
    const byTitle = (a: BookSummary, b: BookSummary) => COLLATE.compare(sortTitle(a.title), sortTitle(b.title));
    if (q.sort === "title") books.sort(byTitle);
    if (q.sort === "author")
      books.sort(
        (a, b) =>
          COLLATE.compare(authorSort(a.authors[0] ?? ""), authorSort(b.authors[0] ?? "")) ||
          COLLATE.compare(a.series ?? "", b.series ?? "") ||
          (a.seriesIndex ?? 0) - (b.seriesIndex ?? 0) ||
          byTitle(a, b),
      );
    return books;
  }

  async get(id: number): Promise<BookDetail> {
    const r = await this.row(id);
    return {
      ...this.summary(r),
      isbn: (r.isbn as string) ?? undefined,
      description: (r.description as string) ?? undefined,
      file: this.abs(r.file as string),
      original: this.abs(r.original as string),
      origin: r.origin as "import" | "calibre",
      originName: r.origin_name as string,
      report: JSON.parse(r.report as string),
      plan: JSON.parse(r.plan as string),
    };
  }

  /** "work" counts books waiting for review too; "review" is those alone. */
  async counts(): Promise<Counts> {
    const [c] = await this.db.all<Counts>(
      `SELECT SUM(removed_at IS NULL) AS "all", SUM(removed_at IS NULL AND state = 'clean') AS clean,
              SUM(removed_at IS NULL AND state IN ('work', 'review')) AS work, SUM(removed_at IS NULL AND state = 'review') AS review,
              SUM(removed_at IS NOT NULL) AS removed FROM books`,
    );
    return { all: c.all ?? 0, clean: c.clean ?? 0, work: c.work ?? 0, review: c.review ?? 0, removed: c.removed ?? 0 };
  }

  /** Books fixed by an older engine, which a refresh brings up to date. Locked books are never fixed, so never stale. */
  async stale(): Promise<number[]> {
    const rows = await this.db.all<{ id: number; plan: string }>("SELECT id, plan FROM books WHERE state != 'locked' ORDER BY id");
    return rows.filter((r) => (JSON.parse(r.plan) as FixPlan).engine < ENGINE).map((r) => r.id);
  }

  /**
   * Re-fix a book with today's engine. Nothing a person chose changes, so
   * it isn't an undo step; undoing an older edit rebuilds with today's engine too.
   */
  async refresh(id: number): Promise<void> {
    const { plan } = await this.snapshot(id);
    if (plan.engine >= ENGINE) return;
    await this.rebuild(id, { ...plan, engine: ENGINE });
  }

  /** How many fixes Magpie has made across the books still in the Library. */
  async repairs(): Promise<number> {
    const rows = await this.db.all<{ report: string }>("SELECT report FROM books WHERE removed_at IS NULL");
    return rows.reduce((n, r) => n + (JSON.parse(r.report) as FixReport).changes.length, 0);
  }

  // ------------------------------------------------------------ changing

  /** Set details (accepted suggestions or a person's edits) and rebuild. One undo step. */
  async edit(id: number, patch: InfoPatch, label = "Edit details"): Promise<BookDetail> {
    const before = await this.snapshot(id);
    const plan: FixPlan = { ...before.plan, info: { ...before.plan.info, ...patch } };
    await this.rebuild(id, plan);
    await this.record(label, [{ id, before, after: { ...before, plan } }]);
    return this.get(id);
  }

  /** "Keep the book's own styling" on or off, for one book or many. One undo step. */
  async keepStyle(ids: number[], keep: boolean): Promise<void> {
    const steps = [];
    for (const id of ids) {
      const before = await this.snapshot(id);
      if (!!before.plan.keepStyle === keep) continue;
      const plan: FixPlan = { ...before.plan, keepStyle: keep || undefined };
      if (!keep) delete plan.keepStyle;
      await this.rebuild(id, plan);
      steps.push({ id, before, after: { ...before, plan } });
    }
    if (steps.length) await this.record(keep ? "Keep the book's styling" : "Clean up the styling", steps);
  }

  /** Accept some suggestions and turn the rest down, for many books at once. One undo step. */
  async review(decisions: { id: number; accept: InfoPatch; dismiss: Suggestion["field"][] }[], label = "Accept suggested details"): Promise<void> {
    const steps = [];
    for (const d of decisions) {
      const before = await this.snapshot(d.id);
      const plan: FixPlan = {
        ...before.plan,
        info: { ...before.plan.info, ...d.accept },
        dismissed: [...new Set([...(before.plan.dismissed ?? []), ...d.dismiss])],
      };
      await this.rebuild(d.id, plan);
      steps.push({ id: d.id, before, after: { ...before, plan } });
    }
    if (steps.length) await this.record(label, steps);
  }

  /**
   * Keep what a catalog lookup found on the book's plan, so it shows on the
   * review sheet. Returns what it replaced; the lookup job turns those into
   * one undo step for the whole run when it ends (recordLookups). Kept small
   * because a job saves its results after every book.
   */
  async lookedUp(id: number, found: Suggestion[], catalog?: CatalogRecord): Promise<LookupPrev> {
    const { plan: was } = await this.snapshot(id);
    await this.rebuild(id, { ...was, found, catalog: catalog ?? was.catalog });
    return { id, found: was.found, catalog: was.catalog };
  }

  /** One undo step for a whole lookup run: each book back to what it had found before. */
  async recordLookups(label: string, prevs: LookupPrev[]) {
    const steps = [];
    for (const p of prevs) {
      const now = await this.snapshot(p.id).catch(() => null);
      if (!now) continue;
      const plan: FixPlan = { ...now.plan, found: p.found, catalog: p.catalog };
      if (p.found === undefined) delete plan.found;
      if (p.catalog === undefined) delete plan.catalog;
      steps.push({ id: p.id, before: { ...now, plan }, after: now });
    }
    if (steps.length) await this.record(label, steps);
  }

  /** Move books to Removed. They are deleted for good after 30 days. One undo step. */
  async remove(ids: number[]): Promise<void> {
    const now = new Date().toISOString();
    const steps = [];
    for (const id of ids) {
      const before = await this.snapshot(id);
      if (before.removed_at) continue;
      await this.db.run("UPDATE books SET removed_at = ? WHERE id = ?", [now, id]);
      steps.push({ id, before, after: { ...before, removed_at: now } });
    }
    if (steps.length) await this.record(ids.length > 1 ? `Remove ${ids.length} books` : "Remove book", steps);
  }

  async restore(ids: number[]): Promise<void> {
    for (const id of ids) await this.db.run("UPDATE books SET removed_at = NULL WHERE id = ?", [id]);
  }

  /** Undo the last change. Returns its label, or null when there's nothing to undo. */
  async undo(): Promise<string | null> {
    // A sort that was cancelled before its first book leaves an empty step; it isn't a change.
    await this.db.run("DELETE FROM history WHERE steps = '[]'");
    const [h] = await this.db.all<{ id: number; label: string; steps: string }>("SELECT * FROM history ORDER BY id DESC LIMIT 1");
    if (!h) return null;
    const steps: { id: number; before: Snapshot; after: Snapshot }[] = JSON.parse(h.steps);
    for (const s of steps.reverse()) {
      const now = await this.snapshot(s.id).catch(() => null);
      if (!now) continue;
      if (JSON.stringify(now.plan) !== JSON.stringify(s.before.plan)) await this.rebuild(s.id, s.before.plan);
      await this.db.run("UPDATE books SET removed_at = ? WHERE id = ?", [s.before.removed_at, s.id]);
      if (s.before.tags !== undefined)
        await this.db.run("UPDATE books SET tags = ?, tags_off = ? WHERE id = ?", [s.before.tags, s.before.tags_off ?? "[]", s.id]);
    }
    await this.db.run("DELETE FROM history WHERE id = ?", [h.id]);
    return h.label;
  }

  async lastChange(): Promise<string | null> {
    const [h] = await this.db.all<{ label: string }>("SELECT label FROM history WHERE steps != '[]' ORDER BY id DESC LIMIT 1");
    return h?.label ?? null;
  }

  /** Delete books that have sat in Removed for 30 days, or all of Removed when `all`. */
  async purgeRemoved(all = false): Promise<number> {
    const cutoff = all ? "9999-12-31" : new Date(Date.now() - REMOVED_DAYS * 864e5).toISOString();
    const gone = await this.db.all("SELECT * FROM books WHERE removed_at IS NOT NULL AND removed_at <= ?", [cutoff]);
    for (const r of gone) {
      for (const k of ["file", "original", "cover"]) if (r[k]) await this.host.fs.remove(this.abs(r[k] as string));
      await this.db.run("DELETE FROM books WHERE id = ?", [r.id]);
    }
    return gone.length;
  }

  // ------------------------------------------------------------ shelves

  /**
   * Sort one book: Magpie's tags are replaced with fresh guesses; a person's and
   * Calibre's stay, and so does anything a person took off. Returns the history
   * step when something changed, for the caller to record.
   */
  async organize(id: number, organizer: Organizer): Promise<{ id: number; before: Snapshot; after: Snapshot } | null> {
    const r = await this.row(id);
    const before = await this.snapshot(id);
    const kept: Tag[] = (JSON.parse(before.tags ?? "[]") as Tag[]).filter((t) => t.by !== "magpie");
    const off = new Set<string>(JSON.parse(before.tags_off ?? "[]"));
    // What Look Up Details found in Open Library counts as subjects too.
    let subjects: string[] = (JSON.parse(r.plan as string) as FixPlan).catalog?.subjects ?? [];
    let opening = "";
    try {
      // A locked book's pages are encrypted, but its package (and subjects) can be read.
      const book = Book.load(await this.host.fs.read(this.abs(r.file as string)), { locked: "allow" });
      subjects = [...readSubjects(book), ...subjects];
      if (r.state !== "locked" && !r.description) opening = readOpening(book);
    } catch {
      // Unreadable now (a missing file): sort on what the Library knows.
    }
    const guesses = await organizer.guess({
      title: r.title as string,
      description: (r.description as string) ?? undefined,
      subjects: [...subjects, ...kept.map((t) => t.name)],
      opening,
    });
    const have = new Set(kept.map((t) => t.name.toLowerCase()));
    const tags = [
      ...kept,
      ...guesses
        .filter((g) => !off.has(g.name) && !have.has(g.name.toLowerCase()))
        .map((g): Tag => ({ name: g.name, by: "magpie", confidence: round(g.confidence), source: g.source })),
    ];
    const key = (ts: Tag[]) => JSON.stringify(ts.map((t) => [t.name, t.by, t.confidence]).sort());
    if (key(tags) === key(JSON.parse(before.tags ?? "[]"))) {
      await this.db.run("UPDATE books SET organized = ? WHERE id = ?", [ORGANIZER, id]);
      return null;
    }
    await this.db.run("UPDATE books SET tags = ?, organized = ? WHERE id = ?", [JSON.stringify(tags), ORGANIZER, id]);
    return { id, before, after: { ...before, tags: JSON.stringify(tags) } };
  }

  /** Live books Magpie hasn't sorted with the current rules. */
  async unsorted(): Promise<number[]> {
    const rows = await this.db.all<{ id: number }>("SELECT id FROM books WHERE removed_at IS NULL AND (organized IS NULL OR organized < ?) ORDER BY id", [
      ORGANIZER,
    ]);
    return rows.map((r) => r.id);
  }

  /** Put tags on and take tags off, for many books at once. One undo step. */
  async tag(ids: number[], add: string[], remove: string[]): Promise<void> {
    add = cleanTags(add);
    const steps = [];
    for (const id of ids) {
      const before = await this.snapshot(id);
      let tags: Tag[] = JSON.parse(before.tags ?? "[]");
      let off: string[] = JSON.parse(before.tags_off ?? "[]");
      const gone = new Set(remove.map((n) => n.toLowerCase()));
      tags = tags.filter((t) => !gone.has(t.name.toLowerCase()));
      off = [...new Set([...off.filter((n) => !add.some((a) => a.toLowerCase() === n.toLowerCase())), ...remove])];
      for (const name of add) if (!tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) tags.push({ name, by: "you" });
      const after = { ...before, tags: JSON.stringify(tags), tags_off: JSON.stringify(off) };
      if (after.tags === before.tags && after.tags_off === before.tags_off) continue;
      await this.db.run("UPDATE books SET tags = ?, tags_off = ? WHERE id = ?", [after.tags, after.tags_off, id]);
      steps.push({ id, before, after });
    }
    const label = remove.length && !add.length ? "Remove tag" : "Add tag";
    if (steps.length) await this.record(label, steps);
  }

  /** The sidebar: shelves with their genres, vibes, other tags, and authors and series with two or more books. */
  async groups(): Promise<Groups> {
    const books = await this.list({});
    const count = (names: Iterable<string>) => {
      const m = new Map<string, number>();
      for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
      return m;
    };
    const tagCounts = count(books.flatMap((b) => [...new Set(b.tags.map((t) => t.name))]));
    const sorted = (m: Map<string, number>, min = 1) =>
      [...m]
        .filter(([, n]) => n >= min)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => COLLATE.compare(a.name, b.name));
    const shelves = KINDS.map((kind) => ({
      name: kind,
      count: tagCounts.get(kind) ?? 0,
      genres: GENRES.filter((g) => g.kind === kind && tagCounts.get(g.name)).map((g) => ({ name: g.name, count: tagCounts.get(g.name)! })),
    })).filter((s) => s.count || s.genres.length);
    const known = new Set<string>([...KINDS, ...GENRE_NAMES, ...VIBE_NAMES]);
    return {
      shelves,
      vibes: VIBES.filter((v) => tagCounts.get(v.name)).map((v) => ({ name: v.name, count: tagCounts.get(v.name)! })),
      tags: sorted(new Map([...tagCounts].filter(([n]) => !known.has(n)))),
      authors: sorted(count(books.flatMap((b) => b.authors)), 2).sort((a, b) => COLLATE.compare(authorSort(a.name), authorSort(b.name))),
      series: sorted(count(books.flatMap((b) => (b.series ? [b.series] : []))), 2),
      unsorted: (await this.unsorted()).length,
    };
  }

  /** A history step that grows as a long job goes, so the whole job undoes at once. */
  async openStep(label: string): Promise<number> {
    const r = await this.db.run("INSERT INTO history (label, steps, at) VALUES (?, '[]', ?)", [label, new Date().toISOString()]);
    return r.lastId;
  }

  async addToStep(historyId: number, step: unknown): Promise<void> {
    await this.db.run("UPDATE history SET steps = json_insert(steps, '$[#]', json(?)) WHERE id = ?", [JSON.stringify(step), historyId]);
  }

  // ------------------------------------------------------------ settings

  async setting<T>(key: string, fallback: T): Promise<T> {
    const [r] = await this.db.all<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
    return r ? JSON.parse(r.value) : fallback;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, JSON.stringify(value)]);
  }

  /** The database, for the job queue. Nothing else outside library/ touches it. */
  get jobsDb(): Db {
    return this.db;
  }

  // ------------------------------------------------------------ internals

  private async migrate() {
    const [{ user_version: v }] = await this.db.all<{ user_version: number }>("PRAGMA user_version");
    if (v > MIGRATIONS.length) throw new UserError("newer-library");
    for (let i = v; i < MIGRATIONS.length; i++) {
      if (i > 0) await this.backup(`before-schema-${i + 1}`);
      try {
        await this.db.exec(`BEGIN; ${MIGRATIONS[i]}; PRAGMA user_version = ${i + 1}; COMMIT;`);
      } catch (e) {
        await this.db.exec("ROLLBACK").catch(() => {});
        throw e;
      }
    }
  }

  /** A consistent copy of library.db in backups/. */
  async backup(tag: string): Promise<string> {
    const rel = `backups/library-${new Date().toISOString().slice(0, 10)}-${tag}.db`;
    await this.host.fs.remove(this.abs(rel));
    await this.db.run("VACUUM INTO ?", [this.abs(rel)]);
    return this.abs(rel);
  }

  private async rebuild(id: number, plan: FixPlan) {
    const r = await this.row(id);
    if (r.state === "locked") throw new UserError("locked-edit");
    const built = fix(await this.host.fs.read(this.abs(r.original as string)), plan);
    let file = r.file as string;
    const want = `books/${bookPath(built.info.authors, built.info.title || stem(r.origin_name as string))}`;
    if (!sameBase(file, want)) {
      const next = await unique(want, (p) => this.host.fs.exists(this.abs(p)));
      await this.host.fs.remove(this.abs(file));
      file = next;
    }
    await this.host.fs.write(this.abs(file), built.bytes);
    await this.db.run(
      `UPDATE books SET title=?, authors=?, author_sort=?, series=?, series_index=?, language=?, publisher=?, year=?, isbn=?, description=?,
         file=?, size=?, state=?, plan=?, report=?, updated_at=? WHERE id=?`,
      [
        built.info.title || stem(r.origin_name as string),
        JSON.stringify(built.info.authors),
        authorSort(built.info.authors[0] ?? ""),
        built.info.series ?? null,
        built.info.seriesIndex ?? null,
        built.info.language,
        built.info.publisher ?? null,
        built.info.year ?? null,
        built.info.isbn ?? null,
        built.info.description ?? null,
        file,
        built.bytes.length,
        stateOf(built.report),
        JSON.stringify(plan),
        JSON.stringify(built.report),
        new Date().toISOString(),
        id,
      ],
    );
  }

  private async saveCover(id: number, own: { bytes: Uint8Array; mediaType: string } | null, fallback?: string): Promise<string | null> {
    if (own) {
      const rel = `covers/${id}.${own.mediaType.split("/")[1].replace("jpeg", "jpg").replace("svg+xml", "svg")}`;
      await this.host.fs.write(this.abs(rel), own.bytes);
      return rel;
    }
    if (fallback && (await this.host.fs.exists(fallback))) {
      const rel = `covers/${id}.${fallback.split(".").pop()!.toLowerCase()}`;
      await this.host.fs.copy(fallback, this.abs(rel));
      return rel;
    }
    return null;
  }

  private async snapshot(id: number): Promise<Snapshot> {
    const r = await this.row(id);
    return { plan: JSON.parse(r.plan as string), removed_at: (r.removed_at as string) ?? null, tags: r.tags as string, tags_off: r.tags_off as string };
  }

  private async record(label: string, steps: unknown[]) {
    await this.db.run("INSERT INTO history (label, steps, at) VALUES (?, ?, ?)", [label, JSON.stringify(steps), new Date().toISOString()]);
    // Keep undo bounded; nobody presses ⌘Z two hundred times.
    await this.db.run("DELETE FROM history WHERE id <= (SELECT MAX(id) - 200 FROM history)");
  }

  private async row(id: number): Promise<Row> {
    const [r] = await this.db.all("SELECT * FROM books WHERE id = ?", [id]);
    if (!r) throw new UserError("no-book");
    return r;
  }

  private async summaryById(id: number) {
    return this.summary(await this.row(id));
  }

  private summary(r: Row): BookSummary {
    const s: BookSummary = {
      id: r.id as number,
      title: r.title as string,
      authors: JSON.parse(r.authors as string),
      language: r.language as string,
      state: r.state as BookState,
      size: r.size as number,
      addedAt: r.added_at as string,
      tags: JSON.parse((r.tags as string) ?? "[]"),
      todo: 0,
    };
    if (r.state === "work" || r.state === "review") {
      const report = JSON.parse(r.report as string) as FixReport;
      s.todo = (report.todos?.length ?? 0) + report.suggestions.length;
    }
    if (r.publisher) s.publisher = r.publisher as string;
    const first = (JSON.parse(r.plan as string) as FixPlan).catalog?.firstYear;
    if (first) s.firstYear = first;
    if (r.series) s.series = r.series as string;
    if (r.series_index != null) s.seriesIndex = r.series_index as number;
    if (r.year != null) s.year = r.year as number;
    if (r.cover) s.cover = this.abs(r.cover as string);
    if (r.removed_at) s.removedAt = r.removed_at as string;
    return s;
  }
}

/** A locked book goes in untouched: the original bytes, and only what its package says about itself. */
function asLocked(bytes: Uint8Array, info: InfoPatch = {}) {
  const book = Book.load(bytes, { locked: "allow" });
  const report: FixReport = { changes: [], suggestions: [], errors: [] };
  return { bytes, info: { ...readInfo(book), ...info }, report, cover: null, locked: true };
}

/** Trimmed, single-spaced, no blanks or repeats, at most 60 characters each. */
export function cleanTags(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const t = n.replace(/\s+/g, " ").trim().slice(0, 60);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

const round = (x: number) => Math.round(x * 100) / 100;

const COLLATE = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const sortTitle = (t: string) => t.replace(/^(the|a|an)\s+/i, "");
/** Lowercase, accents off, punctuation to spaces: what search compares. */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function stateOf(report: FixReport): BookState {
  if (report.suggestions.length) return "review";
  return report.todos?.length ? "work" : "clean";
}

/** "Ursula K. Le Guin" -> "Le Guin, Ursula K." */
export function authorSort(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2 || name.includes(",")) return name.trim();
  let i = parts.length - 1;
  while (i > 1 && /^(de|da|del|der|di|du|la|le|van|von|den|ten|ter)$/i.test(parts[i - 1])) i--;
  if (/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(parts[parts.length - 1]) && i === parts.length - 1 && parts.length > 2) i--;
  return `${parts.slice(i).join(" ")}, ${parts.slice(0, i).join(" ")}`;
}

const stem = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ");
const sameBase = (a: string, b: string) => a.replace(/-\d+(\.epub)$/, "$1") === b;

export async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A stable uuid derived from the original's hash, for books that lack an identifier. */
function uuidFrom(hash: string): string {
  const h = hash.slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
