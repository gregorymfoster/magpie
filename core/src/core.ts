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
import { Library, type ListQuery } from "./library/library.ts";
import { deviceName } from "./naming.ts";
import { DEFAULTS, validate, type Settings } from "./settings.ts";
import { listDevices } from "./send/devices.ts";
import { toKepub } from "./send/kepub.ts";
import { KINDLE_LIMIT } from "./send/kindle.ts";

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
  counts: { all: number; review: number; fixed: number; removed: number };
  /** Label of the change ⌘Z would undo. */
  undo: string | null;
  jobs: Job[];
}

interface AppConfig {
  libraryPath?: string;
}

class Context {
  host: Host;
  library: Library | null = null;
  jobs: Jobs | null = null;
  /** The last unexpected error, for diagnostics; paths are left out like titles are. */
  lastError: string | null = null;
  listeners = new Set<(e: CoreEvent) => void>();
  private changedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: Host) {
    this.host = host;
  }

  emit(e: CoreEvent) {
    for (const l of this.listeners) l(e);
  }

  /** Coalesce bursts (a 1,000-book import) into one refetch every quarter second. */
  changed() {
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
    this.jobs = new Jobs(this.library.jobsDb, runners(this), (job) => this.emit({ type: "job", job }));
    this.jobs.resume();
    await this.saveConfig({ ...(await this.config()), libraryPath: path });
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
      return addResult(c.title, () => ctx.lib().add({ path: c.path!, name: c.title, origin: "calibre", info: c.info, cover: c.cover }));
    },
    kobo: async (item: unknown) => {
      const { id, device } = item as { id: number; device: string };
      const book = await ctx.lib().get(id);
      if (!(await ctx.host.fs.exists(device))) return { label: book.title, outcome: "failed", message: explain("no-device") } satisfies JobResult;
      const kepub = toKepub(await ctx.host.fs.read(book.file));
      const free = await ctx.host.fs.free(device);
      if (free !== null && free < kepub.length + 5e6) return { label: book.title, outcome: "failed", message: explain("device-full") } satisfies JobResult;
      // Resending a book replaces the copy on the reader, keeping its reading position.
      await ctx.host.fs.write(join(device, "Magpie", deviceName(book.authors, book.title, "kepub.epub")), kepub);
      return { label: book.title, outcome: "sent", bookId: id } satisfies JobResult;
    },
  };
}

/** Folders become every .epub inside them, at any depth. Hidden files are skipped. */
/** Details a person (or an AI tool) typed, checked before they're written into a book. */
function checkPatch(p: InfoPatch): InfoPatch {
  if (p.title !== undefined && !p.title.trim()) throw new UserError("empty-title");
  if (p.authors?.some((a) => !a.trim())) throw new UserError("empty-author");
  if (p.year !== undefined && !(Number.isInteger(p.year) && p.year >= 1000 && p.year <= 2200)) throw new UserError("bad-year");
  if (p.seriesIndex !== undefined && !(Number.isFinite(p.seriesIndex) && p.seriesIndex >= 0 && p.seriesIndex < 10000)) throw new UserError("bad-series-number");
  if (p.language && !/^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i.test(p.language.trim())) throw new UserError("bad-language");
  return p;
}

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
        counts: { all: 0, review: 0, fixed: 0, removed: 0 },
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
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) out[k] = await lib.setting(k, DEFAULTS[k]);
  return out;
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

  /** The review sheet's Done: accepted and turned-down suggestions, many books at once. */
  async "books.review"(ctx: Context, a: { decisions: { id: number; accept: InfoPatch; dismiss: Suggestion["field"][] }[] }) {
    await ctx.lib().review(a.decisions);
    ctx.changed();
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

  /** Opens a Mail draft to the Kindle address with the books attached. */
  async "send.kindle"(ctx: Context, a: { ids: number[] }) {
    const to = await ctx.lib().setting("kindleAddress", DEFAULTS.kindleAddress);
    if (!to) throw new UserError("no-kindle-address");
    const books = await Promise.all(a.ids.map((id) => ctx.lib().get(id)));
    if (books.some((b) => b.state === "locked")) throw new UserError("locked-send");
    const files = await Promise.all(books.map(async (b) => ({ name: deviceName(b.authors, b.title, "epub"), bytes: await ctx.host.fs.read(b.file) })));
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

  /** Converts to KEPUB and copies to the Kobo, as a job. */
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
