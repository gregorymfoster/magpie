// Small pieces of motion shared across the window: a count that rolls to its
// new value, something that lingers long enough to leave gracefully, and the
// ring that fills once per Look Up request.

import { useEffect, useRef, useState } from "react";
import { still } from "../motion.ts";

/** A number that rolls up or down to its new value instead of jumping. The first value just appears. */
export function Count({ n }: { n: number }) {
  const last = useRef(n);
  const dir = n > last.current ? "up" : n < last.current ? "down" : "";
  useEffect(() => {
    last.current = n;
  }, [n]);
  return (
    <span key={n} className={"count" + (dir ? ` roll-${dir}` : "")}>
      {n.toLocaleString("en-US")}
    </span>
  );
}

/**
 * Keeps something on screen for `ms` after `show` turns false, so it can play
 * its way out. Returns whether to render it and whether it's leaving.
 */
export function useLinger(show: boolean, ms: number): [boolean, boolean] {
  const [shown, setShown] = useState(show);
  useEffect(() => {
    if (show) return setShown(true);
    if (still()) return setShown(false);
    const t = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(t);
  }, [show, ms]);
  return [show || shown, !show && shown];
}

/** Look Up asks Open Library one book a second; this ring fills once a second while it does. */
export function PaceRing() {
  return (
    <svg className="pace" width={14} height={14} viewBox="0 0 14 14" aria-hidden>
      <circle className="track" cx="7" cy="7" r="5" />
      <circle className="arc" cx="7" cy="7" r="5" />
    </svg>
  );
}
