// Bringing books in, from a drop, Add Books… or Calibre. Shows the job as it
// runs and a summary when it's done. Closing it early leaves the job running
// in the sidebar footer.

import { FileText, Lock } from "lucide-react";
import type { Job, JobResult } from "@magpie/core";
import { Sheet } from "../components/Sheet.tsx";
import { jobProgress } from "../components/Progress.tsx";
import { plural } from "../format.ts";

const CHIP: Record<JobResult["outcome"], [string, string]> = {
  added: ["mut", "Added"],
  duplicate: ["mut", "Already in Library"],
  unreadable: ["bad", "Not added"],
  skipped: ["mut", "Skipped"],
  sent: ["ok", "Sent"],
  failed: ["bad", "Failed"],
};

export function JobSheet({ job, onClose, onReview, reviewCount }: { job: Job; onClose: () => void; onReview: () => void; reviewCount: number }) {
  const done = job.state === "done" || job.state === "cancelled";
  const n = (o: JobResult["outcome"]) => job.results.filter((r) => r.outcome === o).length;
  const sending = job.kind === "kobo";
  const title = done ? (sending ? `Sent ${plural(n("sent"), "book")} to Kobo` : `Added ${plural(n("added"), "book")}`) : job.label;
  return (
    <Sheet label={title} onClose={onClose}>
      <div className="sh-h">
        <h2>{title}</h2>
        <p>
          {sending
            ? done
              ? "Eject the Kobo before unplugging it. The books are in its library now."
              : "Each book is converted to Kobo’s own format on the way, so page numbers and reading stats work."
            : done
              ? "Each file was checked and repaired before it joined your Library. Your originals are kept untouched."
              : "Magpie copies each file in, repairs what it can, and keeps the original."}
        </p>
      </div>
      <div className="sh-b">
        {done
          ? !sending && (
              <div className="sum">
                <div>
                  <b>{n("added")}</b>
                  <span>added</span>
                </div>
                <div>
                  <b>{reviewCount}</b>
                  <span>with details to check</span>
                </div>
                <div>
                  <b>{n("duplicate") + n("unreadable") + n("skipped")}</b>
                  <span>not added</span>
                </div>
              </div>
            )
          : jobProgress(job)}
        <div className="files">
          {job.results
            .slice(-200)
            .reverse()
            .map((r, i) => (
              <div key={i} className="file" title={r.message}>
                <FileText size={13} />
                <span className="fn">{r.label}</span>
                {r.message && r.outcome !== "duplicate" && (
                  <span style={{ color: "var(--fg3)", fontSize: 11, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.message}
                  </span>
                )}
                <span className={`pill ${CHIP[r.outcome][0]}`}>{CHIP[r.outcome][1]}</span>
              </div>
            ))}
          {!job.results.length && (
            <div className="file">
              <span className="fn dim">Starting…</span>
            </div>
          )}
        </div>
      </div>
      <div className="sh-f">
        <span className="note">
          <Lock size={12} />
          Files never leave this Mac.
        </span>
        {done && reviewCount > 0 && !sending && (
          <button className="btn" onClick={onReview}>
            Review {reviewCount} suggested
          </button>
        )}
        <button className="btn pri" onClick={onClose}>
          {done ? "Done" : "Hide"}
        </button>
      </div>
    </Sheet>
  );
}
