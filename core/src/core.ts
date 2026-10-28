// The one door. Every screen, the CLI and `magpie serve` reach the core
// through core.call(command, args) and core.on(listener). Commands are plain
// async functions in the table below; their argument and result types flow to
// the UI from `Api`, so a renamed field is a type error, not a blank screen.
// Changes are pushed as events, never polled.

import { findCalibre, describeCalibre, readCalibre, type CalibreItem } from "./calibre.ts";
import { UserError, explain } from "./errors.ts";
import { join, type Host } from "./host.ts";
import type { InfoPatch, Suggestion } from "./info.ts";
import { Jobs, type Job, type JobResult } from "./jobs.ts";
import { Library, type Counts, type ListQuery, type LookupPrev } from "./library/library.ts";
import { Organizer } from "./organize/organize.ts";
import { deviceName } from "./naming.ts";
import { loadForPreview, preview } from "./preview.ts";
import type { Book } from "./epub.ts";
import { DEFAULTS, validate, type Settings } from "./settings.ts";
import { listDevices } from "./send/devices.ts";
import { KINDLE_LIMIT } from "./send/kindle.ts";
import { coverUrl, descriptionOf, match, recordOf, searchUrl, suggestionsFrom, wants, wantsCover, workUrl, type CatalogDoc } from "./identify/catalog.ts";
import { coverType, imageSize } from "./images.ts";
import { MIN_COVER_HEIGHT } from "./checks.ts";

export type CoreEvent =
  /** Books were added, changed or removed: refetch lists and counts. */
  | { type: "library.changed" }
  /** A job moved on (throttled to about 12 a second) or finished. */
  | { type: "job"; job: Job }
  | { type: "settings.changed" };

export interface AppState {
  version: string;
  /** "open": ready. "missing": the remembered Library's folder isn't there (an unplugged disk). */
  library: { status: "open" | "missing"; path: string };
  counts: Counts;
  /** Label of the change ⌘Z would undo. */
  undo: string | null;
  jobs: Job[];
}

interface AppConfig {
  libraryPath?: string;
}

class Context {
  host: Host;
  organizer: Organizer;
  library: Library | null = null;
  jobs: Jobs | null = null;
  /** The last unexpected error, for diagnostics; paths are left out like titles are. */
  lastError: string | null = null;
  listeners = new Set<(e: CoreEvent) => void>();
  /** The book being previewed, unpacked once while someone turns its pages. Cleared by any change. */
  previewing: { path: string; book: Book } | null = null;
  private changedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: Host) {
    this.host = host;
    this.organizer = new Organizer(host.embed?.bind(host));
  }

  /** Sort books onto shelves as a job: one undo step for the lot. */
  async sort(ids: number[]) {
    if (!ids.length) return null;
    const step = await this.lib().openStep(ids.length === 1 ? "Sort book" : "Sort Library");
    return this.queue().enqueue(
      "organize",
      ids.length === 1 ? "Sorting a book onto shelves" : `Sorting ${ids.length} books onto shelves`,
      ids.map((id) => ({ id, step })),
    );
  }

  emit(e: CoreEvent) {
    for (const l of this.listeners) l(e);
  }

  /** Coalesce bursts (a 1,000-book import) into one refetch every quarter second. */
  changed() {
    this.previewing = null;
    if (this.changedTimer) return;
    this.changedTimer = setTimeout(() => {
      this.changedTimer = null;
      this.emit({ type: "library.changed" });
    }, 250);
  }

  lib(): Library {
    if (!this.library) throw new UserError("no-library");
    return this.library;
  }

  queue(): Jobs {
    if (!this.jobs) throw new UserError("no-library");
    return this.jobs;
  }

  get configPath() {
    return join(this.host.env.config, "config.json");
  }

  async config(): Promise<AppConfig> {
    if (!(await this.host.fs.exists(this.configPath))) return {};
    return JSON.parse(new TextDecoder().decode(await this.host.fs.read(this.configPath)));
  }

  async saveConfig(c: AppConfig) {
    await this.host.fs.write(this.configPath, new TextEncoder().encode(JSON.stringify(c, null, 2)));
  }

  defaultLibrary() {
    return join(this.host.env.home, "Books/Magpie");
  }

  async openLibrary(path: string) {
    await this.closeLibrary();
    this.library = await Library.open(this.host, path);
    this.jobs = new Jobs(this.library.jobsDb, runners(this), (job) => this.emit({ type: "job", job }), {
      // A whole lookup run is one ⌘Z.
      lookup: async (job) => {
        await this.lib().recordLookups(
          "Look Up Details",
          job.results.flatMap((r) => (r.undo ? [r.undo as LookupPrev] : [])),
        );
        this.changed();
      },
    });
    this.jobs.resume();
    // Books fixed by an older engine are re-fixed and re-checked once, in the background.
    const active = await this.jobs.active();
    if (!active.some((j) => j.kind === "refresh" && (j.state === "queued" || j.state === "running"))) {
      const stale = await this.library.stale();
      if (stale.length)
        await this.jobs.enqueue(
          "refresh",
          `Checking ${stale.length} book${stale.length === 1 ? "" : "s"}`,
          stale.map((id) => ({ id })),
        );
    }
    await this.saveConfig({ ...(await this.config()), libraryPath: path });
    // A Library from before shelves existed (or before the rules changed) gets sorted once, in the background.
    const sorting = (await this.jobs.active()).some((j) => j.kind === "organize" && (j.state === "queued" || j.state === "running"));
    if (!sorting && (await this.library.setting("organize", DEFAULTS.organize))) await this.sort(await this.library.unsorted());
    this.emit({ type: "library.changed" });
  }

  async closeLibrary() {
    if (!this.library) return;
    await this.jobs?.idle();
    await this.library.close();
    this.library = null;
    this.jobs = null;
  }
}

function runners(ctx: Context) {
  const addResult = async (label: string, add: () => ReturnType<Library["add"]>): Promise<JobResult> => {
    const o = await add();
    // New books are sorted as they arrive; that's part of adding them, not a separate undo step.
    if (o.kind === "added" && (await ctx.lib().setting("organize", DEFAULTS.organize))) await ctx.lib().organize(o.book.id, ctx.organizer);
    ctx.changed();
    if (o.kind === "unreadable") return { label, outcome: "unreadable", message: explain(o.reason) };
    if (o.kind === "duplicate") return { label: o.book.title, outcome: "duplicate", message: "Already in your Library.", bookId: o.book.id };
    return { label: o.book.title, outcome: "added", bookId: o.book.id, message: o.locked ? explain("drm") : undefined };
  };
  return {
    import: (item: unknown) => {
      const { path, name } = item as { path: string; name?: string };
      return addResult(name ?? path.split("/").pop()!, () => ctx.lib().add({ path, name }));
    },
    calibre: async (item: unknown) => {
      const c = item as CalibreItem;
      if (!c.path) return { label: c.title, outcome: "skipped", message: explain("calibre-no-epub") } satisfies JobResult;
      if (!(await ctx.host.fs.exists(c.path))) return { label: c.title, outcome: "skipped", message: explain("calibre-file-missing") } satisfies JobResult;
      return addResult(c.title, () => ctx.lib().add({ path: c.path!, name: c.title, origin: "calibre", info: c.info, cover: c.cover, tags: c.tags }));
    },
    refresh: async (item: unknown) => {
      const { id } = item as { id: number };
      const lib = ctx.lib();
      await lib.refresh(id).catch(() => {});
      const book = await lib.get(id).catch(() => null);
      ctx.changed();
      return { label: book?.title ?? `Book ${id}`, outcome: "checked", bookId: id } satisfies JobResult;
    },
    organize: async (item: unknown) => {
      const { id, step } = item as { id: number; step: number };
      const lib = ctx.lib();
      const book = await lib.get(id);
      const change = await lib.organize(id, ctx.organizer);
      if (change) await lib.addToStep(step, change);
      ctx.changed();
      return { label: book.title, outcome: "sorted", bookId: id } satisfies JobResult;
    },
    kobo: async (item: unknown) => {
      const { id, device } = item as { id: number; device: string };
      const book = await ctx.lib().get(id);
      if (!(await ctx.host.fs.exists(device))) return { label: book.title, outcome: "failed", message: explain("no-device") } satisfies JobResult;
      if (book.state === "locked") return { label: book.title, outcome: "failed", message: explain("locked-send") } satisfies JobResult;
      const kepub = await ctx.lib().deviceCopy(id, "kepub");
      const free = await ctx.host.fs.free(device);
      if (free !== null && free < kepub.length + 5e6) return { label: book.title, outcome: "failed", message: explain("device-full") } satisfies JobResult;
      // Resending a book replaces the copy on the reader, keeping its reading position.
      await ctx.host.fs.write(join(device, "Magpie", deviceName(book.authors, book.title, "kepub.epub")), kepub);
      return { label: book.title, outcome: "sent", bookId: id } satisfies JobResult;
    },
    lookup: async (item: unknown) => {
      const { id } = item as { id: number };
      const info = await ctx.lib().get(id);
      const label = info.title;
      if (info.state === "locked" || info.removedAt) return { label, outcome: "skipped", bookId: id } satisfies JobResult;
      const coverWanted = wantsCover(info.report);
      if (!wants(info) && !coverWanted) return { label, outcome: "skipped", message: explain("lookup-complete"), bookId: id } satisfies JobResult;
      const search = async (url: string | null) => (url ? (((await ctx.host.web.getJson(url)) as { docs?: CatalogDoc[] }).docs ?? []) : []);
      let m;
      try {
        // By ISBN first; an ISBN Open Library doesn't know falls back to title and author.
        m = match(info, await search(searchUrl(info)));
        if (!m && info.isbn) m = match({ ...info, isbn: undefined }, await search(searchUrl({ ...info, isbn: undefined })));
      } catch {
        return { label, outcome: "failed", message: explain("offline"), bookId: id } satisfies JobResult;
      }
      if (!m && !searchUrl({ ...info, isbn: undefined }))
        return { label, outcome: "skipped", message: explain("lookup-nothing"), bookId: id } satisfies JobResult;
      if (!m) {
        const step = await ctx.lib().lookedUp(id, []);
        return { label, outcome: "skipped", message: explain("lookup-no-match"), bookId: id, undo: step } satisfies JobResult;
      }
      const description = info.description ? undefined : descriptionOf(await ctx.host.web.getJson(workUrl(m.doc.key)).catch(() => null));
      const found = suggestionsFrom(info, m, description);
      if (coverWanted && m.doc.cover_i) {
        // A cover that won't download, isn't a picture or is too small to be better is simply not suggested.
        const bytes = await ctx.host.web.getBytes(coverUrl(m.doc.cover_i)).catch(() => null);
        const size = bytes && coverType(bytes) ? imageSize(bytes) : null;
        const kept = bytes && size && size.h >= MIN_COVER_HEIGHT ? await ctx.lib().keepCover(bytes) : null;
        if (kept)
          found.push({ field: "cover", current: "", value: kept.file, source: `Open Library, matched by ${m.by}`, confidence: m.confidence, from: "catalog" });
      }
      const step = await ctx.lib().lookedUp(id, found, recordOf(m));
      ctx.changed();
      const fields = found.map((s) => (s.field === "authors" ? "author" : s.field));
      return {
        label,
        outcome: found.length ? "found" : "skipped",
        message: found.length ? `Found ${list(fields)}.` : "Matched, but Open Library had nothing the book is missing.",
        bookId: id,
        undo: step,
      } satisfies JobResult;
    },
  };
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Books worth a lookup: not locked, missing something, and (unless `again`) never looked up. */
async function lookupCandidates(ctx: Context, again: boolean): Promise<number[]> {
  const out: number[] = [];
  for (const b of (await ctx.lib().list({})).sort((x, y) => x.id - y.id)) {
    if (b.state === "locked") continue;
    const d = await ctx.lib().get(b.id);
    if ((wants(d) || wantsCover(d.report)) && (again || d.plan.found === undefined)) out.push(b.id);
  }
  return out;
}

/** Details a person (or an AI tool) typed, checked before they're written into a book. */
function checkPatch(p: InfoPatch): InfoPatch {
  if (p.title !== undefined && !p.title.trim()) throw new UserError("empty-title");
  if (p.authors?.some((a) => !a.trim())) throw new UserError("empty-author");
  if (p.year !== undefined && !(Number.isInteger(p.year) && p.year >= 1000 && p.year <= 2200)) throw new UserError("bad-year");
  if (p.seriesIndex !== undefined && !(Number.isFinite(p.seriesIndex) && p.seriesIndex >= 0 && p.seriesIndex < 10000)) throw new UserError("bad-series-number");
  if (p.language && !/^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i.test(p.language.trim())) throw new UserError("bad-language");
  return p;
}

/** Folders become every .epub inside them, at any depth. Hidden files are skipped. */
async function expand(host: Host, paths: string[]): Promise<{ path: string }[]> {
  const out: { path: string }[] = [];
  const walk = async (dir: string) => {
    for (const e of (await host.fs.list(dir)).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".")) continue;
      if (e.dir) await walk(join(dir, e.name));
      else if (/\.epub$/i.test(e.name)) out.push({ path: join(dir, e.name) });
    }
  };
  for (const p of paths) {
    if ((await host.fs.list(p)).length) await walk(p);
    // A file dropped on its own goes through even when it isn't an EPUB, so it gets a sentence saying why not.
    else if (/\.[a-z0-9]+$/i.test(p)) out.push({ path: p });
  }
  return out;
}

/** Everything the window needs at launch, opening the Library if it isn't open yet. */
async function appState(ctx: Context): Promise<AppState> {
  if (!ctx.library) {
    const want = (await ctx.config()).libraryPath;
    if (want && !(await ctx.host.fs.exists(join(want, "library.db")))) {
      return {
        version: ctx.host.env.version,
        library: { status: "missing", path: want },
        counts: { all: 0, clean: 0, work: 0, review: 0, removed: 0 },
        undo: null,
        jobs: [],
      };
    }
    await ctx.openLibrary(want ?? ctx.defaultLibrary());
  }
  const lib = ctx.lib();
  return {
    version: ctx.host.env.version,
    library: { status: "open", path: lib.root },
    counts: await lib.counts(),
    undo: await lib.lastChange(),
    jobs: await ctx.queue().active(),
  };
}

async function getSettings(ctx: Context): Promise<Settings> {
  const lib = ctx.lib();
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) out[k] = await lib.setting(k, DEFAULTS[k]);
  return out as unknown as Settings;
}

const commands = {
  "app.state": appState,

  /** Open (or create) a Library at a folder: Locate Library… and New Library… */
  async "library.use"(ctx: Context, a: { path: string }): Promise<AppState> {
    await ctx.openLibrary(a.path);
    return appState(ctx);
  },

  async "books.list"(ctx: Context, q: ListQuery = {}) {
    return ctx.lib().list(q);
  },

  async "books.get"(ctx: Context, a: { id: number }) {
    return ctx.lib().get(a.id);
  },

  /**
   * One chapter of a book as a reader would lay it out, from the fixed book or
   * its untouched original (to see what a fix changed). Never for a locked book.
   */
  async "books.preview"(ctx: Context, a: { id: number; chapter?: number; original?: boolean }) {
    const d = await ctx.lib().get(a.id);
    if (d.state === "locked") throw new UserError("locked-preview");
    const path = a.original ? d.original : d.file;
    if (ctx.previewing?.path !== path) ctx.previewing = { path, book: loadForPreview(await ctx.host.fs.read(path)) };
    return preview(ctx.previewing.book, a.chapter ?? 0);
  },

  /** Bring files or folders in. Returns the job; progress arrives as events. */
  async "books.import"(ctx: Context, a: { paths: string[] }) {
    const items = await expand(ctx.host, a.paths);
    const label = items.length === 1 ? `Adding ${items[0].path.split("/").pop()}` : `Adding ${items.length} books`;
    return ctx.queue().enqueue("import", label, items);
  },

  async "books.edit"(ctx: Context, a: { id: number; patch: InfoPatch }) {
    const r = await ctx.lib().edit(a.id, checkPatch(a.patch));
    ctx.changed();
    return r;
  },

  /**
   * "Keep the book's own styling": leave the publisher's fonts, sizes, spacing
   * and colours as they are (keep: true), or let Magpie clean them up again.
   */
  async "books.keepStyle"(ctx: Context, a: { ids: number[]; keep: boolean }) {
    for (const id of a.ids) if ((await ctx.lib().get(id)).state === "locked") throw new UserError("locked-edit");
    await ctx.lib().keepStyle(a.ids, a.keep);
    ctx.changed();
  },

  /** Put a JPEG or PNG into the book as its cover (Choose a Cover…). Undoable. */
  async "books.setCover"(ctx: Context, a: { id: number; path: string }) {
    if (!(await ctx.host.fs.exists(a.path))) throw new UserError("missing-file");
    const book = await ctx.lib().setCover(a.id, await ctx.host.fs.read(a.path));
    ctx.changed();
    return book;
  },

  /** The review sheet's Done: accepted and turned-down suggestions, many books at once. */
  async "books.review"(ctx: Context, a: { decisions: { id: number; accept: InfoPatch; dismiss: Suggestion["field"][] }[] }) {
    await ctx.lib().review(a.decisions);
    ctx.changed();
  },

  /** Put tags on or take them off, for one book or many. Taking off one of Magpie's tags keeps it off. */
  async "books.tag"(ctx: Context, a: { ids: number[]; add?: string[]; remove?: string[] }) {
    await ctx.lib().tag(a.ids, a.add ?? [], a.remove ?? []);
    ctx.changed();
  },

  /** The sidebar's groups: Fiction and Nonfiction with their genres, vibes, tags, authors and series. */
  async "library.groups"(ctx: Context) {
    return ctx.lib().groups();
  },

  /**
   * Sort books onto shelves (kind, genre, vibe) with the rules and the local model.
   * Without ids, every book not yet sorted; with `again`, every book. A person's tags are never touched.
   */
  async "library.organize"(ctx: Context, a: { ids?: number[]; again?: boolean } = {}) {
    const ids = a.ids ?? (a.again ? (await ctx.lib().list({})).map((b) => b.id) : await ctx.lib().unsorted());
    return ctx.sort(ids);
  },

  async "books.remove"(ctx: Context, a: { ids: number[] }) {
    await ctx.lib().remove(a.ids);
    ctx.changed();
  },

  async "books.restore"(ctx: Context, a: { ids: number[] }) {
    await ctx.lib().restore(a.ids);
    ctx.changed();
  },

  /** Empty Removed now instead of waiting 30 days. */
  async "books.purge"(ctx: Context) {
    const n = await ctx.lib().purgeRemoved(true);
    ctx.changed();
    return { deleted: n };
  },

  async "history.undo"(ctx: Context) {
    const label = await ctx.lib().undo();
    ctx.changed();
    return { undone: label };
  },

  /** The Calibre library on this Mac, if there is one, with how many books would come over. */
  async "calibre.find"(ctx: Context, a: { path?: string } = {}) {
    return a.path ? describeCalibre(ctx.host, a.path) : findCalibre(ctx.host);
  },

  async "calibre.import"(ctx: Context, a: { path: string }) {
    const items = await readCalibre(ctx.host, a.path).catch(() => {
      throw new UserError("calibre-missing");
    });
    return ctx.queue().enqueue("calibre", `Bringing in ${items.length} books from Calibre`, items);
  },

  /**
   * Look Up Details: ask Open Library for what books are missing (year,
   * publisher, language, description, a missing author). Sends only titles,
   * authors and ISBNs. Results wait in Needs Review; the whole run is one undo.
   * With no ids, every book that is missing something and hasn't been looked up.
   */
  async "books.lookup"(ctx: Context, a: { ids?: number[]; again?: boolean } = {}) {
    const ids = a.ids ?? (await lookupCandidates(ctx, !!a.again));
    if (!ids.length) return null;
    const label = ids.length === 1 ? `Looking up ${(await ctx.lib().get(ids[0])).title}` : `Looking up ${ids.length} books`;
    return ctx.queue().enqueue(
      "lookup",
      label,
      ids.map((id) => ({ id })),
    );
  },

  /** How many books a Look Up Details for everything would check. */
  async "books.lookupCount"(ctx: Context) {
    return { count: (await lookupCandidates(ctx, false)).length };
  },

  async "jobs.get"(ctx: Context, a: { id: number }) {
    return ctx.queue().get(a.id);
  },

  async "jobs.cancel"(ctx: Context, a: { id: number }) {
    await ctx.queue().cancel(a.id);
  },

  async "devices.list"(ctx: Context) {
    return listDevices(ctx.host);
  },

  /** Which Library books Magpie has put on a Kobo (matched by the file name it gave them), and how many other files are in its Magpie folder. */
  async "devices.books"(ctx: Context, a: { device: string }) {
    const there = new Set((await ctx.host.fs.list(join(a.device, "Magpie"))).filter((e) => !e.dir).map((e) => e.name));
    const ids = (await ctx.lib().list({})).filter((b) => there.has(deviceName(b.authors, b.title, "kepub.epub"))).map((b) => b.id);
    return { ids, others: there.size - ids.length };
  },

  /** Opens a Mail draft to the Kindle address with the books attached, each a Kindle-safe copy of the clean book. */
  async "send.kindle"(ctx: Context, a: { ids: number[] }) {
    const to = await ctx.lib().setting("kindleAddress", DEFAULTS.kindleAddress);
    if (!to) throw new UserError("no-kindle-address");
    const books = await Promise.all(a.ids.map((id) => ctx.lib().get(id)));
    if (books.some((b) => b.state === "locked")) throw new UserError("locked-send");
    const files = await Promise.all(
      books.map(async (b) => ({ name: deviceName(b.authors, b.title, "epub"), bytes: await ctx.lib().deviceCopy(b.id, "kindle") })),
    );
    if (files.reduce((n, f) => n + f.bytes.length, 0) * 1.37 > KINDLE_LIMIT) throw new UserError("kindle-too-large");
    const subject = books.length === 1 ? books[0].title : `${books.length} books`;
    // Mail attaches files by path, so the books wait in a scratch folder until it's sent.
    const dir = join(ctx.host.env.temp, `Send-to-Kindle-${Date.now()}`);
    const attachments = files.map((f, i) => join(dir, files.findIndex((g) => g.name === f.name) < i ? f.name.replace(/\.epub$/, `-${i + 1}.epub`) : f.name));
    for (const [i, f] of files.entries()) await ctx.host.fs.write(attachments[i], f.bytes);
    await ctx.host.mail({ to, subject, body: "Sent from Magpie.", attachments }).catch(() => {
      throw new UserError("mail-failed");
    });
    return { to, attachments };
  },

  /** Copies the books to the Kobo as KEPUB (built once and kept), as a job. */
  async "send.kobo"(ctx: Context, a: { ids: number[]; device: string }) {
    if (!(await listDevices(ctx.host)).some((d) => d.path === a.device)) throw new UserError("no-device");
    for (const id of a.ids) if ((await ctx.lib().get(id)).state === "locked") throw new UserError("locked-send");
    return ctx.queue().enqueue(
      "kobo",
      a.ids.length === 1 ? "Sending to Kobo" : `Sending ${a.ids.length} books to Kobo`,
      a.ids.map((id) => ({ id, device: a.device })),
    );
  },

  "settings.get": getSettings,

  async "settings.set"(ctx: Context, patch: Partial<Settings>): Promise<Settings> {
    for (const [k, v] of Object.entries(validate(patch))) await ctx.lib().setSetting(k, v);
    ctx.emit({ type: "settings.changed" });
    return getSettings(ctx);
  },

  /** The running tally in Settings: every fix Magpie has made to the books still in the Library. */
  async "library.repairs"(ctx: Context) {
    return { repairs: await ctx.lib().repairs() };
  },

  /** For GitHub issues: versions, counts and which fixers ran or failed. No titles, no contents. */
  async "app.diagnostics"(ctx: Context) {
    const lib = ctx.lib();
    const books = await lib.list({});
    const fixers = new Map<string, number>();
    const failures = new Map<string, number>();
    for (const b of books.slice(0, 500)) {
      const d = await lib.get(b.id);
      for (const c of d.report.changes) fixers.set(c.fixer, (fixers.get(c.fixer) ?? 0) + 1);
      for (const e of d.report.errors) failures.set(e.fixer, (failures.get(e.fixer) ?? 0) + 1);
    }
    const fmt = (m: Map<string, number>) => [...m].map(([k, v]) => `${k} ${v}`).join(", ") || "none";
    return [
      `Magpie ${ctx.host.env.version}`,
      `Books: ${JSON.stringify(await lib.counts())}`,
      `Fixes made: ${fmt(fixers)}`,
      `Fixer failures: ${fmt(failures)}`,
      `Jobs: ${(await ctx.queue().active()).map((j) => `${j.kind} ${j.state} ${j.done}/${j.total}`).join(", ") || "none"}`,
      `Last error: ${ctx.lastError ?? "none"}`,
    ].join("\n");
  },
} satisfies Record<string, (ctx: Context, args: never) => Promise<unknown>>;

export type Api = typeof commands;
export type CommandName = keyof Api;
export type Args<K extends CommandName> = Parameters<Api[K]>[1];
export type Result<K extends CommandName> = Awaited<ReturnType<Api[K]>>;

export interface Core {
  call<K extends CommandName>(command: K, ...args: undefined extends Args<K> ? [] | [Args<K>] : [Args<K>]): Promise<Result<K>>;
  on(listener: (e: CoreEvent) => void): () => void;
  /** Resolves when no job is running. For tests and the CLI. */
  idle(): Promise<void>;
  close(): Promise<void>;
}

export function createCore(host: Host): Core {
  const ctx = new Context(host);
  return {
    async call(command, ...args) {
      const fn = commands[command] as (ctx: Context, a: unknown) => Promise<never>;
      if (!fn) throw new Error(`Unknown command ${String(command)}`);
      // Any command opens the remembered Library first, so a script or an AI tool needn't start with app.state.
      try {
        if (!ctx.library && command !== "library.use") await appState(ctx);
        return await fn(ctx, args[0]);
      } catch (e) {
        if (e instanceof UserError) throw e;
        // Anything else (a host's raw "os error 2", even a thrown string) becomes the one general sentence.
        ctx.lastError = `${String(command)}: ${e instanceof Error ? e.message : String(e)}`.replace(/(\/[^\s/:'"]+)+/g, "<path>");
        throw new Error(explain("unexpected"));
      }
    },
    on(listener) {
      ctx.listeners.add(listener);
      return () => ctx.listeners.delete(listener);
    },
    idle: async () => ctx.jobs?.idle(),
    close: () => ctx.closeLibrary(),
  };
}

export const COMMANDS = Object.keys(commands) as CommandName[];
