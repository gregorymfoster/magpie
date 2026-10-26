import { Send, Wand2, PencilLine, Trash2, Check, AlertCircle, Lock } from "lucide-react";
import type { BookSummary } from "@magpie/core";
import { useCall } from "../api.tsx";
import { Cover } from "./Cover.tsx";
import { StatePill } from "./Books.tsx";
import { authors, date, language, plural, size } from "../format.ts";

export type Act = (a: "send" | "review" | "edit" | "remove" | "restore", ids?: number[]) => void;

export function Inspector({ chosen, act }: { chosen: BookSummary[]; act: Act }) {
  if (!chosen.length)
    return (
      <aside className="insp" aria-label="Inspector">
        <div className="empty" style={{ padding: "60px 20px" }}>
          <b style={{ fontSize: 18 }}>No book selected</b>
          Select a book to see its details and what Magpie fixed.
        </div>
      </aside>
    );
  if (chosen.length > 1) {
    const review = chosen.filter((b) => b.state === "review").length;
    return (
      <aside className="insp" aria-label="Inspector">
        <div className="ip">
          <div className="stack">
            {chosen.slice(0, 4).map((b, i) => (
              <div
                key={b.id}
                style={{ position: "absolute", left: 14 + i * 18, top: 4 + i * 6, width: 92, zIndex: 4 - i, transform: `rotate(${(i - 1.5) * 3}deg)` }}
              >
                <Cover b={b} />
              </div>
            ))}
          </div>
          <h2>{plural(chosen.length, "book")} selected</h2>
          <div className="by">{review ? `${review} with details to check` : "All ready to read"}</div>
          <div className="acts">
            <button className="btn pri" onClick={() => act("send")}>
              <Send size={13} />
              Send
            </button>
            {review > 0 && (
              <button className="btn" onClick={() => act("review")}>
                <Wand2 size={13} />
                Review {review}
              </button>
            )}
            {!chosen[0].removedAt && (
              <button className="btn" onClick={() => act("remove")}>
                <Trash2 size={13} />
                Remove
              </button>
            )}
          </div>
        </div>
      </aside>
    );
  }
  return <One b={chosen[0]} act={act} />;
}

function One({ b, act }: { b: BookSummary; act: Act }) {
  const { data: d } = useCall("books.get", { id: b.id });
  const rows: [string, React.ReactNode][] = [
    ["Series", b.series && `${b.series}${b.seriesIndex ? ` · ${b.seriesIndex}` : ""}`],
    ["Published", b.year],
    ["Publisher", d?.publisher],
    ["Language", language(b.language)],
    ["ISBN", d?.isbn],
    ["Size", size(b.size)],
    ["Added", date(b.addedAt)],
    ["Came in as", d && <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{d.originName}</span>],
  ];
  return (
    <aside className="insp" aria-label="Inspector">
      <div className="ip">
        <div className="cvw">
          <Cover b={b} />
        </div>
        <h2 title={b.title}>{b.title}</h2>
        <div className="by" title={authors(b.authors)}>
          {authors(b.authors)}
        </div>
        <div className="acts">
          {b.removedAt ? (
            <button className="btn pri" onClick={() => act("restore")}>
              Put back
            </button>
          ) : b.state === "locked" ? null : (
            <>
              <button className="btn pri" onClick={() => act("send")}>
                <Send size={13} />
                Send
              </button>
              {b.state === "review" && (
                <button className="btn" onClick={() => act("review")}>
                  <Wand2 size={13} />
                  Review
                </button>
              )}
              <button className="btn" onClick={() => act("edit")} title="Edit details (⌘I)">
                <PencilLine size={13} />
                Edit
              </button>
            </>
          )}
        </div>
        <hr className="dash" />
        <div>
          <div className="h">
            What Magpie did
            <span className="sp" />
            <StatePill state={b.state} />
          </div>
          {d && (
            <div className="changes">
              {b.state === "locked" && (
                <div>
                  <Lock size={12} style={{ color: "var(--accent)" }} />
                  <span>
                    Locked with DRM by the store that sold it. Magpie keeps it exactly as it came and can’t fix, edit or send it. Read it in the store’s own
                    app.
                  </span>
                </div>
              )}
              {b.state !== "locked" && d.report.changes.length === 0 && d.report.suggestions.length === 0 && (
                <div style={{ color: "var(--fg2)" }}>Nothing needed fixing. The original was already sound.</div>
              )}
              {d.report.changes.map((c, i) => (
                <div key={i}>
                  <Check size={12} strokeWidth={2.2} />
                  <span>{c.message}</span>
                </div>
              ))}
              {d.report.suggestions.map((s, i) => (
                <div key={`s${i}`}>
                  <AlertCircle size={12} style={{ color: "var(--warn)" }} />
                  <span>
                    {s.field === "description" ? (
                      <>Suggested a description, from {s.source}.</>
                    ) : (
                      <>
                        Suggested {s.field === "authors" ? "author" : s.field}: “{s.value}”, from {s.source}.
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <hr className="dash" />
        <div>
          <div className="h">Details</div>
          <dl className="kv">
            {rows.map(([k, v]) => (
              <Pair key={k} k={k} v={v} />
            ))}
          </dl>
        </div>
      </div>
    </aside>
  );
}

const Pair = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <>
    <dt>{k}</dt>
    <dd style={v ? undefined : { color: "var(--fg3)" }}>{v || "Not set"}</dd>
  </>
);
