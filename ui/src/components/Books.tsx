import { Check } from "lucide-react";
import type { BookSummary } from "@magpie/core";
import { Cover } from "./Cover.tsx";
import { authors, date, size } from "../format.ts";

type Select = (id: number, e: React.MouseEvent) => void;

export function Grid({ items, sel, onSel, onOpen }: { items: BookSummary[]; sel: number[]; onSel: Select; onOpen: (id: number) => void }) {
  return (
    <div className="grid" role="list">
      {items.map((b) => (
        <button
          key={b.id}
          role="listitem"
          className={"tile" + (sel.includes(b.id) ? " on" : "")}
          onClick={(e) => onSel(b.id, e)}
          onDoubleClick={() => onOpen(b.id)}
          data-book={b.id}
        >
          <Cover b={b} />
          <div>
            <div className="t">{b.title}</div>
            <div className="a">
              {b.state === "review" && <span className="dot rv" />}
              {authors(b.authors)}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

export function List({ items, sel, onSel, onOpen }: { items: BookSummary[]; sel: number[]; onSel: Select; onOpen: (id: number) => void }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
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
          {items.map((b) => (
            <tr key={b.id} className={sel.includes(b.id) ? "on" : ""} onClick={(e) => onSel(b.id, e)} onDoubleClick={() => onOpen(b.id)} data-book={b.id}>
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
  return <span className="pill mut">Ready</span>;
}
