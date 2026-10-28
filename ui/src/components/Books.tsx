import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Check, Columns3, Lock } from "lucide-react";
import { GENRE_NAMES, KINDS, VIBE_NAMES, type BookSummary } from "@magpie/core";
import { Cover } from "./Cover.tsx";
import { authors, date, language, size } from "../format.ts";

type Select = (id: number, e: React.MouseEvent) => void;

const PAGE = 240;

/**
 * Books that joined the Library in the last few seconds rise into place one
 * after another. Each book gets its delay the first time it's drawn, and only
 * the first screenful staggers, so a 10,000-book import isn't held up.
 */
const arriving = new Map<number, number>();
const seen = new Set<number>();
const STAGGER = 45;
const FIRST_SCREEN = 24;
function arrival(b: BookSummary): { fresh: boolean; style?: React.CSSProperties } {
  if (!seen.has(b.id)) {
    seen.add(b.id);
    if (Date.now() - Date.parse(b.addedAt) < 15_000) {
      arriving.set(b.id, Math.min(arriving.size, FIRST_SCREEN) * STAGGER);
      setTimeout(() => arriving.delete(b.id), 3000);
    }
  }
  const delay = arriving.get(b.id);
  return delay === undefined ? { fresh: false } : { fresh: true, style: { animationDelay: `${delay}ms` } };
}

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

type Props = { items: BookSummary[]; sel: number[]; onSel: Select; onOpen: (id: number) => void; back?: number[] };

export function Grid({ items, sel, onSel, onOpen, back = [] }: Props) {
  const reveal = useReveal(items.length);
  const { shown, sentinel } = reveal;
  const keys = useKeys(items, sel, onSel, onOpen, reveal);
  const on = new Set(sel);
  return (
    <>
      <div className="grid" role="listbox" aria-multiselectable aria-label="Books" ref={(el) => void (keys.box.current = el)} onKeyDown={keys.onKeyDown}>
        {items.slice(0, shown).map((b) => {
          const a = arrival(b);
          return (
            <button
              key={b.id}
              role="option"
              aria-selected={on.has(b.id)}
              tabIndex={keys.tabIndex(b.id)}
              className={"tile" + (on.has(b.id) ? " on" : "") + (a.fresh ? " fresh" : "") + (back.includes(b.id) ? " back" : "")}
              style={a.style}
              onClick={(e) => onSel(b.id, e)}
              onDoubleClick={() => onOpen(b.id)}
              data-book={b.id}
            >
              <Cover b={b} />
              <div>
                <div className="t">{b.title}</div>
                <div className="a">
                  {(b.state === "review" || b.state === "work") && <span className="dot rv" aria-label="Needs work" />}
                  {b.state === "clean" && <BadgeCheck className="seal" size={11} strokeWidth={2.2} aria-label="Clean" />}
                  {b.state === "locked" && <Lock size={10} strokeWidth={2.2} aria-label="Locked with DRM" />}
                  {authors(b.authors)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {sentinel}
    </>
  );
}

type Column = { id: string; label: string; width: string; cell: (b: BookSummary) => React.ReactNode; className?: string };

const names = (b: BookSummary, keep: (n: string) => boolean) =>
  b.tags
    .map((t) => t.name)
    .filter(keep)
    .join(", ");
const isKind = (n: string) => (KINDS as string[]).includes(n);
const isOther = (n: string) => !isKind(n) && !GENRE_NAMES.has(n) && !VIBE_NAMES.has(n);

/** Every column the list can show, in order. Title is always there. */
export const COLUMNS: Column[] = [
  { id: "author", label: "Author", width: "22%", cell: (b) => authors(b.authors), className: "mut" },
  { id: "series", label: "Series", width: "16%", cell: (b) => (b.series ? `${b.series}${b.seriesIndex ? ` ${b.seriesIndex}` : ""}` : ""), className: "mut" },
  {
    id: "year",
    label: "Year",
    width: "64px",
    className: "num",
    // The year it was first published when Look Up Details found it; otherwise the book's own, usually its edition's, shown lighter.
    cell: (b) =>
      b.firstYear ??
      (b.year ? (
        <span className="ed" title="The year of this edition. Look Up Details finds when the book first came out.">
          {b.year}
        </span>
      ) : (
        ""
      )),
  },
  {
    id: "rating",
    label: "Rating",
    width: "64px",
    className: "num",
    // How Open Library's readers rate it, out of 5, once Look Up Details has asked.
    cell: (b) => (b.rating ? <span title={`From ${b.ratings} readers on Open Library`}>{b.rating.toFixed(1)}</span> : ""),
  },
  { id: "shelf", label: "Shelf", width: "96px", cell: (b) => names(b, isKind), className: "mut" },
  { id: "genre", label: "Genre", width: "15%", cell: (b) => names(b, (n) => GENRE_NAMES.has(n)), className: "mut" },
  { id: "vibe", label: "Vibe", width: "12%", cell: (b) => names(b, (n) => VIBE_NAMES.has(n)), className: "mut" },
  { id: "tags", label: "Tags", width: "14%", cell: (b) => names(b, isOther), className: "mut" },
  { id: "publisher", label: "Publisher", width: "14%", cell: (b) => b.publisher ?? "", className: "mut" },
  { id: "language", label: "Language", width: "88px", cell: (b) => language(b.language), className: "mut" },
  { id: "size", label: "Size", width: "72px", cell: (b) => size(b.size), className: "num" },
  { id: "added", label: "Added", width: "100px", cell: (b) => date(b.addedAt), className: "num" },
  { id: "status", label: "Status", width: "124px", cell: (b) => <StatePill b={b} /> },
];
export const DEFAULT_COLUMNS = ["author", "series", "year", "genre", "status"];

function useColumns() {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("magpie.columns") ?? "null");
      if (Array.isArray(saved)) return saved;
    } catch {}
    return DEFAULT_COLUMNS;
  });
  const toggle = (id: string) =>
    setIds((cur) => {
      const next = cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id];
      try {
        localStorage.setItem("magpie.columns", JSON.stringify(next));
      } catch {}
      return next;
    });
  return { shown: COLUMNS.filter((c) => ids.includes(c.id)), ids, toggle };
}

/** Right-click the header, or press the button at its end, for a menu of columns to show. */
function ColumnMenu({ at, ids, toggle, onClose }: { at: { x: number; y: number }; ids: string[]; toggle: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  return (
    <div className="menu" role="menu" aria-label="Columns" ref={ref} style={{ left: Math.min(at.x, window.innerWidth - 190), top: at.y }}>
      <div className="mh">Show columns</div>
      {COLUMNS.map((c) => (
        <button key={c.id} role="menuitemcheckbox" aria-checked={ids.includes(c.id)} onClick={() => toggle(c.id)}>
          <span className="ck">{ids.includes(c.id) && <Check size={12} strokeWidth={2.4} />}</span>
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function List({ items, sel, onSel, onOpen, back = [] }: Props) {
  const reveal = useReveal(items.length);
  const { shown, sentinel } = reveal;
  const keys = useKeys(items, sel, onSel, onOpen, reveal);
  const cols = useColumns();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const on = new Set(sel);
  // Fixed-width columns add up; past the window's width the list scrolls sideways rather than squeezing titles to nothing.
  const minWidth = 36 + 200 + cols.shown.reduce((n, c) => n + (c.width.endsWith("px") ? parseInt(c.width) : 90), 0) + 28;
  return (
    <div className="tbl-wrap">
      <table
        className="tbl"
        role="grid"
        aria-label="Books"
        aria-multiselectable
        style={{ minWidth }}
        ref={(el) => void (keys.box.current = el)}
        onKeyDown={keys.onKeyDown}
      >
        <colgroup>
          <col className="c-cv" />
          <col />
          {cols.shown.map((c) => (
            <col key={c.id} style={{ width: c.width }} />
          ))}
          <col className="c-more" />
        </colgroup>
        <thead
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <tr>
            <th className="th" />
            <th>Title</th>
            {cols.shown.map((c) => (
              <th key={c.id}>{c.label}</th>
            ))}
            <th className="more">
              <button
                aria-label="Choose columns"
                title="Choose columns"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setMenu({ x: r.right - 180, y: r.bottom + 4 });
                }}
              >
                <Columns3 size={13} />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.slice(0, shown).map((b) => (
            <tr
              key={b.id}
              tabIndex={keys.tabIndex(b.id)}
              aria-selected={on.has(b.id)}
              className={(on.has(b.id) ? "on" : "") + (back.includes(b.id) ? " back" : "")}
              onClick={(e) => onSel(b.id, e)}
              onDoubleClick={() => onOpen(b.id)}
              data-book={b.id}
            >
              <td className="th">
                <Cover b={b} />
              </td>
              <td className="tt">{b.title}</td>
              {cols.shown.map((c) => (
                <td key={c.id} className={c.className}>
                  {c.cell(b)}
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      {sentinel}
      {menu && <ColumnMenu at={menu} ids={cols.ids} toggle={cols.toggle} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Clean, or what stands between the book and Clean. */
export function StatePill({ b }: { b: Pick<BookSummary, "state" | "todo"> }) {
  const { state } = b;
  if (state === "clean")
    return (
      <span className="pill ok" title="Passed every check: cover, details and layout">
        <BadgeCheck size={11} strokeWidth={2.4} />
        Clean
      </span>
    );
  if (state === "review") return <span className="pill rv">Check details</span>;
  // A book from before checks, waiting for its first check.
  if (state === "work" && !b.todo) return <span className="pill mut">Checking</span>;
  if (state === "work") return <span className="pill rv">{b.todo === 1 ? "1 to do" : `${b.todo} to do`}</span>;
  if (state === "locked")
    return (
      <span className="pill bad">
        <Lock size={11} strokeWidth={2.4} />
        DRM
      </span>
    );
  return null;
}
