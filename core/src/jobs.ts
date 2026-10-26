// Background work: one queue in the Library, one worker per process. A job is
// a list of items run in order; after each item its result and the count are
// saved, so quitting halfway loses at most one item and the job carries on
// at next launch. Every item must be safe to run twice (importing the same
// file twice finds the duplicate).

import type { Db } from "./host.ts";
import { UserError } from "./errors.ts";

export type JobKind = "import" | "calibre" | "kobo";
export type JobState = "queued" | "running" | "done" | "cancelled";

export interface JobResult {
  /** What the item was, for a person: a file name or a book title. */
  label: string;
  outcome: "added" | "duplicate" | "unreadable" | "skipped" | "sent" | "failed";
  /** A sentence, for anything other than added or sent. */
  message?: string;
  bookId?: number;
}

export interface Job {
  id: number;
  kind: JobKind;
  label: string;
  total: number;
  done: number;
  state: JobState;
  results: JobResult[];
  createdAt: string;
  finishedAt?: string;
}

export type Runner = (item: unknown) => Promise<JobResult>;

export class Jobs {
  private db: Db;
  private runners: Record<JobKind, Runner>;
  private onProgress: (job: Job) => void;
  private running: Promise<void> | null = null;
  private cancelled = new Set<number>();
  private lastEmit = 0;

  constructor(db: Db, runners: Record<JobKind, Runner>, onProgress: (job: Job) => void) {
    this.db = db;
    this.runners = runners;
    this.onProgress = onProgress;
  }

  async enqueue(kind: JobKind, label: string, items: unknown[]): Promise<Job> {
    const r = await this.db.run("INSERT INTO jobs (kind, label, items, state, created_at) VALUES (?, ?, ?, 'queued', ?)", [
      kind,
      label,
      JSON.stringify(items),
      new Date().toISOString(),
    ]);
    const job = await this.get(r.lastId);
    this.onProgress(job);
    this.kick();
    return job;
  }

  /** Pick up anything a previous launch left unfinished. */
  resume() {
    this.kick();
  }

  async cancel(id: number) {
    this.cancelled.add(id);
    await this.db.run("UPDATE jobs SET state = 'cancelled', finished_at = ? WHERE id = ? AND state = 'queued'", [new Date().toISOString(), id]);
    this.onProgress(await this.get(id));
  }

  /** Unfinished jobs, plus those finished in the last minute so the UI can show the summary. */
  async active(): Promise<Job[]> {
    const since = new Date(Date.now() - 60_000).toISOString();
    const rows = await this.db.all("SELECT * FROM jobs WHERE state IN ('queued','running') OR finished_at >= ? ORDER BY id", [since]);
    return rows.map(toJob);
  }

  async get(id: number): Promise<Job> {
    const [r] = await this.db.all("SELECT * FROM jobs WHERE id = ?", [id]);
    if (!r) throw new UserError("no-job");
    return toJob(r);
  }

  /** Resolves when the queue is empty. For tests and the CLI. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private kick() {
    if (this.running) return;
    this.running = this.drain().finally(() => (this.running = null));
  }

  private async drain() {
    for (;;) {
      const [row] = await this.db.all("SELECT * FROM jobs WHERE state IN ('queued','running') ORDER BY id LIMIT 1");
      if (!row) return;
      await this.runJob(row);
    }
  }

  private async runJob(row: Record<string, unknown>) {
    const id = row.id as number;
    const items: unknown[] = JSON.parse(row.items as string);
    const results: JobResult[] = JSON.parse(row.results as string);
    let done = row.done as number;
    await this.db.run("UPDATE jobs SET state = 'running' WHERE id = ?", [id]);
    const runner = this.runners[row.kind as JobKind];
    while (done < items.length) {
      if (this.cancelled.has(id)) break;
      let result: JobResult;
      try {
        result = await runner(items[done]);
      } catch (e) {
        result = { label: labelOf(items[done]), outcome: "failed", message: e instanceof Error ? e.message : String(e) };
      }
      results.push(result);
      done++;
      await this.db.run("UPDATE jobs SET done = ?, results = ? WHERE id = ?", [done, JSON.stringify(results), id]);
      if (Date.now() - this.lastEmit > 80) {
        this.lastEmit = Date.now();
        this.onProgress(await this.get(id));
      }
    }
    const state = this.cancelled.has(id) ? "cancelled" : "done";
    await this.db.run("UPDATE jobs SET state = ?, finished_at = ? WHERE id = ?", [state, new Date().toISOString(), id]);
    this.cancelled.delete(id);
    this.onProgress(await this.get(id));
  }
}

function labelOf(item: unknown): string {
  const o = item as { name?: string; path?: string; title?: string };
  return o?.name ?? o?.title ?? o?.path?.split("/").pop() ?? "item";
}

function toJob(r: Record<string, unknown>): Job {
  const j: Job = {
    id: r.id as number,
    kind: r.kind as JobKind,
    label: r.label as string,
    total: (JSON.parse(r.items as string) as unknown[]).length,
    done: r.done as number,
    state: r.state as JobState,
    results: JSON.parse(r.results as string),
    createdAt: r.created_at as string,
  };
  if (r.finished_at) j.finishedAt = r.finished_at as string;
  return j;
}
