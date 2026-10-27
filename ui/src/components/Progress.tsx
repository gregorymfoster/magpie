// The one progress row: what's happening on the left, count and ETA on the
// right, a bar underneath. Never a bare spinner when progress is knowable.
// The bar glides between updates and a soft light runs along it while it runs.

import type { Job } from "@magpie/core";
import { eta, plural } from "../format.ts";

export function Progress({ label, done, total, startedAt }: { label: string; done: number; total: number; startedAt: string }) {
  return (
    <div className="prog">
      <div className="lbl">
        <b>{label}</b>
        <span>
          {done.toLocaleString("en-US")} of {plural(total, "book")} · {eta(done, total, startedAt)}
        </span>
      </div>
      <div className="bar run">
        <i style={{ width: `${Math.min(100, (100 * done) / Math.max(1, total))}%` }} />
      </div>
    </div>
  );
}

/** Inks itself in when something finishes. */
export function DoneCheck({ size = 16 }: { size?: number }) {
  return (
    <svg className="done-check" width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="8" />
      <path d="M4.5 8.4l2.3 2.2 4.7-4.9" />
    </svg>
  );
}

export const jobProgress = (j: Job) => <Progress label={j.label} done={j.done} total={j.total} startedAt={j.createdAt} />;
