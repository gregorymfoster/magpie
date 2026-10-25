// The one progress row: what's happening on the left, count and ETA on the
// right, a bar underneath. Never a bare spinner when progress is knowable.

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
      <div className="bar">
        <i style={{ width: `${Math.min(100, (100 * done) / Math.max(1, total))}%` }} />
      </div>
    </div>
  );
}

export const jobProgress = (j: Job) => <Progress label={j.label} done={j.done} total={j.total} startedAt={j.createdAt} />;
