import { useEffect, useRef, useState } from "react";
import { Check, Lock } from "lucide-react";
import type { BookSummary } from "@magpie/core";
import { Cover } from "./Cover.tsx";
import { authors, date, size } from "../format.ts";

type Select = (id: number, e: React.MouseEvent) => void;

const PAGE = 240;

/**
 * Big Libraries (a 10,000-book Calibre import) would put every cover in the
 * page at once. Show a page of books and add the next page when the end
 * scrolls into view; selecting and searching still work on every book.
 */
function useReveal(total: number) {
  const [shown, setShown] = useState(PAGE);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el || shown >= total) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setShown((n) => n + PAGE), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, total]);
  const sentinel = shown < total ? <div ref={end} className="reveal" aria-hidden /> : null;
  return { shown, setShown, sentinel };
}

/**
 * Finder-style keys for the books: arrows move the selection (Shift extends
 * it), Home and End jump, Return opens Edit Details. Only one book is a Tab
 * stop, so Tab leaves the grid instead of walking 2,000 covers.
 */
function useKeys(items: BookSummary[], sel: number[], onSel: Select, onOpen: (id: number) => void, reveal: { shown: number; setShown: (n: number) => void }) {
  const box = useRef<HTMLElement | null>(null);
  const anchor = sel.length ? sel[sel.length - 1] : items[0]?.id;
  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = items.findIndex((b) => b.id === Number((document.activeElement as HTMLElement | null)?.dataset.book ?? anchor));
    if (e.key === "Enter" && at >= 0) return (e.preventDefault(), onOpen(items[at].id));
    const grid = box.current?.classList.contains("grid");
    const cols = grid && box.current ? getComputedStyle(box.current).gridTemplateColumns.split(" ").length : 1;
    const step: Record<string, number> = {
      ArrowRight: grid ? 1 : 0,
      ArrowLeft: grid ? -1 : 0,
      ArrowDown: cols,
      ArrowUp: -cols,
      Home: -Infinity,
      End: Infinity,
    };
    if (!step[e.key]) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(items.length - 1, (at < 0 ? 0 : at) + step[e.key]));
    if (next >= reveal.shown) reveal.setShown(next + PAGE);
    const id = items[next].id;
    onSel(id, { shiftKey: e.shiftKey, metaKey: false, ctrlKey: false } as React.MouseEvent);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-book="${id}"]`);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "nearest" });
    });
  };
  const tabIndex = (id: number) => (id === anchor ? 0 : -1);
  return { box, onKeyDown, tabIndex };
}

export function Grid({ items, sel, onSel, onOpen }: { items: BookSummary[]; sel: number[]; onSel: Select; onOpen: (id: number) => void }) {
  const reveal = useReveal(items.length);
  const { shown, sentinel } = reveal;
  const keys = useKeys(items, sel, onSel, onOpen, reveal);
  const on = new Set(sel);
  return (
    <>
      <div className="grid" role="listbox" aria-multiselectable aria-label="Books" ref={(el) => void (keys.box.current = el)} onKeyDown={keys.onKeyDown}>
        {items.slice(0, shown).map((b) => (
          <button
            key={b.id}
            role="option"
            aria-selected={on.has(b.id)}
            tabIndex={keys.tabIndex(b.id)}
            className={"tile" + (on.has(b.id) ? " on" : "")}
            onClick={(e) => onSel(b.id, e)}
            onDoubleClick={() => onOpen(b.id)}
            data-book={b.id}
          >
            <Cover b={b} />
            <div>
              <div className="t">{b.title}</div>
              <div className="a">
                {b.state === "review" && <span className="dot rv" />}
                {b.state === "locked" && <Lock size={10} strokeWidth={2.2} aria-label="Locked with DRM" />}
                {authors(b.authors)}
              </div>
            </div>
          </button>
        ))}
      </div>
      {sentinel}
    </>
  );
}

export function List({ items, sel, onSel, onOpen }: { items: BookSummary[]; sel: number[]; onSel: Select; onOpen: (id: number) => void }) {
  const reveal = useReveal(items.length);
  const { shown, sentinel } = reveal;
  const keys = useKeys(items, sel, onSel, onOpen, reveal);
  const on = new Set(sel);
  return (
    <div className="tbl-wrap">
      <table className="tbl" role="grid" aria-label="Books" aria-multiselectable ref={(el) => void (keys.box.current = el)} onKeyDown={keys.onKeyDown}>
        <thead>
          <tr>
            <th className="th" />
            <th>Title</th>
            <th>Author</th>
            <th>Series</th>
            <th>Size</th>
            <th>Added</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.slice(0, shown).map((b) => (
            <tr
              key={b.id}
              tabIndex={keys.tabIndex(b.id)}
              aria-selected={on.has(b.id)}
              className={on.has(b.id) ? "on" : ""}
              onClick={(e) => onSel(b.id, e)}
              onDoubleClick={() => onOpen(b.id)}
              data-book={b.id}
            >
              <td className="th">
                <Cover b={b} />
              </td>
              <td className="tt">{b.title}</td>
              <td className="mut">{authors(b.authors)}</td>
              <td className="mut">{b.series ? `${b.series}${b.seriesIndex ? ` ${b.seriesIndex}` : ""}` : ""}</td>
              <td className="num">{size(b.size)}</td>
              <td className="num">{date(b.addedAt)}</td>
              <td>
                <StatePill state={b.state} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sentinel}
    </div>
  );
}

export function StatePill({ state }: { state: BookSummary["state"] }) {
  if (state === "review") return <span className="pill rv">Check details</span>;
  if (state === "fixed")
    return (
      <span className="pill ok">
        <Check size={11} strokeWidth={2.4} />
        Fixed
      </span>
    );
  if (state === "locked")
    return (
      <span className="pill bad">
        <Lock size={11} strokeWidth={2.4} />
        DRM
      </span>
    );
  return <span className="pill mut">Ready</span>;
}
