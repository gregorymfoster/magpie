import { useState } from "react";
import { Send, Wand2, PencilLine, Trash2, Check, AlertCircle, Lock, Sparkles, X, BookOpen } from "lucide-react";
import type { BookSummary, Tag, Todo } from "@magpie/core";
import { useAction, useCall } from "../api.tsx";
import { useToast } from "./Toasts.tsx";
import { Cover } from "./Cover.tsx";
import { StatePill } from "./Books.tsx";
import { authors, date, language, plural, size } from "../format.ts";

export type Act = (a: "send" | "review" | "edit" | "preview" | "cover" | "remove" | "restore", ids?: number[]) => void;

export function Inspector({ chosen, act, onTag }: { chosen: BookSummary[]; act: Act; onTag: (name: string) => void }) {
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
    const work = chosen.filter((b) => b.state === "review" || b.state === "work").length;
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
          <div className="by">
            {work ? `${work} need${work === 1 ? "s" : ""} work` : chosen.every((b) => b.state === "clean") ? "All clean" : "Ready to read"}
          </div>
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
          <hr className="dash" />
          <Tags books={chosen} onTag={onTag} />
        </div>
      </aside>
    );
  }
  return <One b={chosen[0]} act={act} onTag={onTag} />;
}

function One({ b, act, onTag }: { b: BookSummary; act: Act; onTag: (name: string) => void }) {
  const { data: d } = useCall("books.get", { id: b.id });
  const rows: [string, React.ReactNode][] = [
    ["Series", b.series && `${b.series}${b.seriesIndex ? ` · ${b.seriesIndex}` : ""}`],
    ["First published", b.firstYear],
    ["This edition", b.year],
    [
      "Rating",
      b.rating && <span title="The average from readers on Open Library, out of 5">{`${b.rating.toFixed(1)} from ${plural(b.ratings!, "reader")}`}</span>,
    ],
    ["Publisher", d?.publisher],
    ["Language", language(b.language)],
    ["ISBN", d?.isbn],
    ["Size", size(b.size)],
    ["Added", date(b.addedAt)],
    ["Came in as", d && <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{d.originName}</span>],
  ];
  return (
    <aside className="insp" aria-label="Inspector">
      {/* Keyed by book so moving the selection cross-fades the details. */}
      <div className="ip" key={b.id}>
        {b.state === "locked" || b.removedAt ? (
          <div className="cvw">
            <Cover b={b} />
          </div>
        ) : (
          // Opening the cover opens the book on a reader, as in Finder's Quick Look.
          <button className="cvw open" onClick={() => act("preview")} title="Preview on a reader (Space)" aria-label="Preview on a reader">
            <Cover b={b} />
          </button>
        )}
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
              <button className="btn" onClick={() => act("preview")} title="Preview on a reader (Space)" aria-label="Preview on a reader">
                <BookOpen size={13} />
              </button>
            </>
          )}
        </div>
        <hr className="dash" />
        {d && !!d.report.todos?.length && (
          <>
            <Todos todos={d.report.todos} act={act} />
            <hr className="dash" />
          </>
        )}
        <Tags books={[b]} onTag={onTag} />
        <hr className="dash" />
        <div>
          <div className="h">
            What Magpie did
            <span className="sp" />
            <StatePill b={b} />
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
                    {s.field === "description" || s.field === "cover" ? (
                      <>
                        Suggested a {s.field}, from {s.source}.
                      </>
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
          {d && b.state !== "locked" && !b.removedAt && <KeepStyle id={b.id} keep={!!d.plan.keepStyle} />}
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

/** "Keep the book's own styling": the publisher's fonts, sizes and colours stay as they came. Undoable like any change. */
function KeepStyle({ id, keep }: { id: number; keep: boolean }) {
  const call = useAction();
  return (
    <label className="pv-check">
      <input type="checkbox" checked={keep} onChange={(e) => void call("books.keepStyle", { ids: [id], keep: e.target.checked })} />
      <span>
        Keep the book’s own styling
        <small>Leave the publisher’s fonts, sizes, spacing and colours as they came, even where they override your reader’s settings.</small>
      </span>
    </label>
  );
}

/** What stands between the book and Clean, each with the one thing that settles it. */
function Todos({ todos, act }: { todos: Todo[]; act: Act }) {
  const fix: Record<Todo["action"], [string, Parameters<Act>[0]] | null> = {
    edit: ["Edit details", "edit"],
    preview: ["Preview", "preview"],
    cover: ["Choose a Cover…", "cover"],
  };
  return (
    <div>
      <div className="h">To do</div>
      <div className="changes todos">
        {todos.map((t) => {
          const f = fix[t.action];
          return (
            <div key={t.id}>
              <AlertCircle size={12} style={{ color: "var(--warn)" }} />
              <span>
                {t.message}
                {f && (
                  <>
                    {" "}
                    <button className="link" onClick={() => act(f[1])}>
                      {f[0]}
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const Pair = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <>
    <dt>{k}</dt>
    <dd style={v ? undefined : { color: "var(--fg3)" }}>{v || "Not set"}</dd>
  </>
);

/** Why a tag is there, for its tooltip. */
function why(t: Tag): string {
  if (t.by === "you") return "Your tag.";
  if (t.by === "calibre") return "Brought over from Calibre.";
  const sure = t.confidence ? `, ${Math.round(t.confidence * 100)}% sure` : "";
  return `Magpie sorted this from ${t.source ?? "the book"}${sure}. Take it off and Magpie won’t put it back.`;
}

/**
 * Shelves, genres, vibes and a person's own tags, as chips. Several books:
 * the tags they all share, and a new tag goes on every one.
 */
function Tags({ books, onTag }: { books: BookSummary[]; onTag: (name: string) => void }) {
  const act = useAction();
  const toast = useToast();
  const [text, setText] = useState("");
  const { data: groups } = useCall("library.groups");
  const ids = books.map((b) => b.id);
  const shared = books[0].tags.filter((t) => books.every((b) => b.tags.some((u) => u.name === t.name)));
  const known = groups
    ? [...groups.shelves.flatMap((s) => [s.name, ...s.genres.map((g) => g.name)]), ...groups.vibes.map((v) => v.name), ...groups.tags.map((t) => t.name)]
    : [];
  const change = async (args: { add?: string[]; remove?: string[] }) => {
    try {
      await act("books.tag", { ids, ...args });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : String(e), error: true });
    }
  };
  return (
    <div>
      <div className="h">Tags</div>
      <div className="chips">
        {shared.map((t) => (
          <span key={t.name} className={"chip" + (t.by === "magpie" ? " ai" : "")} title={why(t)}>
            {t.by === "magpie" && <Sparkles size={10} strokeWidth={2} aria-label="Sorted by Magpie" />}
            <button className="nm" onClick={() => onTag(t.name)}>
              {t.name}
            </button>
            <button className="x" aria-label={`Take off ${t.name}`} onClick={() => void change({ remove: [t.name] })}>
              <X size={10} strokeWidth={2.2} />
            </button>
          </span>
        ))}
        <form
          className="chip-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void change({ add: [text] });
            setText("");
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={books.length > 1 ? "Tag them all" : "Add a tag"}
            list="known-tags"
            aria-label="Add a tag"
          />
          <datalist id="known-tags">
            {known.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </form>
      </div>
    </div>
  );
}
