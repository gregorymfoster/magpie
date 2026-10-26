// Check suggested details: the one place Magpie's guesses reach a person.
// Nothing is written until accepted; low-confidence guesses start unticked.

import { useMemo, useState } from "react";
import { BookOpen, Check, Globe, Info, Lock } from "lucide-react";
import type { BookDetail, Suggestion } from "@magpie/core";
import { patchFor } from "@magpie/core/suggestions";
import { useAction, useCall } from "../api.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { Cover } from "../components/Cover.tsx";
import { useToast } from "../components/Toasts.tsx";
import { plural } from "../format.ts";

const FIELD: Record<Suggestion["field"], string> = {
  title: "Title",
  authors: "Author",
  year: "Published",
  publisher: "Publisher",
  language: "Language",
  description: "Description",
};

export function ReviewSheet({ onClose }: { onClose: () => void }) {
  const { data: list } = useCall("books.list", { state: "review" });
  const ids = useMemo(() => (list ?? []).map((b) => b.id), [list]);
  const [cur, setCur] = useState(0);
  const id = ids[Math.min(cur, ids.length - 1)];
  const { data: d } = useCall("books.get", { id }, { enabled: id !== undefined });
  const act = useAction();
  const toast = useToast();
  const [picks, setPicks] = useState<Record<number, boolean[]>>({});

  if (list && !list.length)
    return (
      <Sheet label="Nothing to check" onClose={onClose}>
        <div className="sh-h">
          <h2>Nothing to check</h2>
          <p>Every book’s details are settled.</p>
        </div>
        <div className="sh-f">
          <button className="btn pri" onClick={onClose}>
            OK
          </button>
        </div>
      </Sheet>
    );
  if (!d || !list) return null;

  const sugg = d.report.suggestions;
  const p = picks[d.id] ?? sugg.map((s) => s.confidence >= 0.8);
  const decide = (b: BookDetail, ticks: boolean[]) => ({
    id: b.id,
    accept: patchFor(b.report.suggestions.filter((_, j) => ticks[j])),
    dismiss: b.report.suggestions.filter((_, j) => !ticks[j]).map((s) => s.field),
  });
  const apply = async (decisions: ReturnType<typeof decide>[], label: string) => {
    try {
      await act("books.review", { decisions });
      toast({ message: label, undo: () => void act("history.undo") });
    } catch (e) {
      toast({ message: (e as Error).message, error: true });
    }
  };
  const acceptOne = async () => {
    await apply([decide(d, p)], "Details updated");
    if (ids.length <= 1) onClose();
  };
  const acceptAll = async () => {
    const all = await Promise.all(list.map((b) => act("books.get", { id: b.id })));
    await apply(
      all.map((b) => decide(b, picks[b.id] ?? b.report.suggestions.map((s) => s.confidence >= 0.8))),
      `Updated ${plural(all.length, "book")}`,
    );
    onClose();
  };
  const n = p.filter(Boolean).length;
  return (
    <Sheet wide label="Check suggested details" onClose={onClose}>
      <div className="sh-h">
        <h2>Check suggested details</h2>
        <p>Nothing changes until you accept it. Untick anything that looks wrong.</p>
      </div>
      <div className="rvw">
        <div className="rv-l">
          {list.map((b, j) => (
            <button key={b.id} className={"row" + (b.id === d.id ? " on" : "")} onClick={() => setCur(j)}>
              <Cover b={b} />
              <span style={{ minWidth: 0 }}>
                <div className="tt">{b.title}</div>
                <div className="ct">{b.authors.join(" & ") || "Unknown author"}</div>
              </span>
            </button>
          ))}
        </div>
        <div className="rv-r">
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
            <div style={{ width: 40 }}>
              <Cover b={d} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg2)", overflowWrap: "anywhere" }}>{d.originName}</div>
              <div style={{ fontSize: 12, color: "var(--fg3)" }}>
                Book {ids.indexOf(d.id) + 1} of {ids.length}
              </div>
            </div>
          </div>
          <table className="dt">
            <thead>
              <tr>
                <th style={{ width: 22 }} />
                <th>Field</th>
                <th>Now</th>
                <th>Suggested</th>
              </tr>
            </thead>
            <tbody>
              {sugg.map((s, j) => (
                <tr key={j} className={p[j] ? "pick" : ""}>
                  <td>
                    <button
                      className={"cb" + (p[j] ? " on" : "")}
                      aria-label={`Accept ${FIELD[s.field]}`}
                      aria-pressed={p[j]}
                      onClick={() => setPicks({ ...picks, [d.id]: p.map((v, q) => (q === j ? !v : v)) })}
                    >
                      {p[j] && <Check size={10} strokeWidth={3} />}
                    </button>
                  </td>
                  <td className="f">{FIELD[s.field]}</td>
                  <td className="old">{s.current || <span className="empty-old">empty</span>}</td>
                  <td>
                    <div className={"new" + (s.field === "description" ? " long" : "")} title={s.field === "description" ? s.value : undefined}>
                      {s.value}
                    </div>
                    <div className="src">
                      {s.from === "catalog" ? (
                        <>
                          <Globe size={11} />
                          {s.source}
                        </>
                      ) : (
                        <>
                          <BookOpen size={11} />
                          In the book: {s.source.replace(/^the /, "")}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: "var(--fg3)", marginTop: 12, display: "flex", gap: 6 }}>
            <Info size={13} style={{ flex: "none" }} />
            Suggestions come from the book’s own pages (its title page, copyright page or Project Gutenberg header) or, when you’ve used Look Up Details, from
            Open Library. Unticked ones are turned down, and the book keeps what it says.
          </p>
        </div>
      </div>
      <div className="sh-f">
        <span className="note">
          <Lock size={12} />
          Nothing is sent anywhere.
        </span>
        <button className="btn ghost" onClick={acceptAll}>
          Accept all books
        </button>
        <button className="btn" onClick={() => setCur((cur + 1) % ids.length)}>
          Skip
        </button>
        <button className="btn pri" onClick={acceptOne}>
          {n ? `Accept ${plural(n, "change")}` : "Keep as is"}
        </button>
      </div>
    </Sheet>
  );
}
