// A book's cover: its own image when it has one, otherwise a typographic
// cover in one of three house styles, coloured from the title so the same
// book always looks the same.

import { useState } from "react";
import type { BookSummary } from "@magpie/core";
import { useTransport } from "../api.tsx";
import { authors } from "../format.ts";

const TONES = [
  "#6B2232",
  "#7A2E2A",
  "#5A6B47",
  "#85817B",
  "#B9B1A6",
  "#A27E57",
  "#3A2F29",
  "#3F4954",
  "#E7DFD1",
  "#8B4A33",
  "#6B6744",
  "#CFC5B6",
  "#24303A",
  "#7D7E80",
];
const LIGHT = new Set(["#B9B1A6", "#E7DFD1", "#CFC5B6"]);

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function Cover({ b, className = "" }: { b: Pick<BookSummary, "title" | "authors" | "cover">; className?: string }) {
  const t = useTransport();
  // A cover file the book declares but that won't decode gets the typographic cover instead of a broken image.
  const [broken, setBroken] = useState<string | null>(null);
  if (b.cover && broken !== b.cover) {
    const src = b.cover;
    return (
      <div className={`cv ${className}`}>
        <img className="cover-img" src={t.fileUrl(src)} alt="" loading="lazy" draggable={false} onError={() => setBroken(src)} />
      </div>
    );
  }
  const h = hash(b.title + b.authors.join());
  const bg = TONES[h % TONES.length];
  const style = h % 3;
  const name = b.title.length > 60 ? b.title.split(/[;:]/)[0] : b.title;
  const by = authors(b.authors);
  return (
    <div className={`cv s${style} ${className}`} style={{ background: bg, color: LIGHT.has(bg) ? "#2B2622" : "#F1EADF" }}>
      {style === 1 ? (
        <div className="in">
          <div className="band">
            <div className="ct">{name}</div>
          </div>
          <div className="low">
            <div className="ca">{by}</div>
          </div>
        </div>
      ) : (
        <div className="in">
          {style === 2 && <span className="stripe" />}
          <div className="ct">{name}</div>
          <div className="rule" />
          <div className="ca">{by}</div>
        </div>
      )}
    </div>
  );
}
