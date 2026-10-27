import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DEFAULT_READER_SETTINGS, READERS, reader, readerCss, type ReaderSettings } from "@magpie/core/readers";
import { useCall } from "../api.tsx";
import { Sheet } from "../components/Sheet.tsx";

const KEY = "magpie.preview";
interface Saved extends ReaderSettings {
  reader: string;
}

function load(): Saved {
  const url = new URLSearchParams(location.search).get("reader");
  let saved: Partial<Saved> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {}
  return { ...DEFAULT_READER_SETTINGS, reader: READERS[0].id, ...saved, ...(url ? { reader: url } : {}) };
}

/** Where to land once a chapter is laid out: its first page, its last (paging back), or the same place (a setting changed). */
type Want = { at: "first" } | { at: "last" } | { at: "same"; ratio: number };

/**
 * How a book reads on a Kindle, Kobo or phone: its chapters laid out a screen
 * at a time at the reader's size, in its default face, with the reader's
 * settings. Space and the arrow keys turn pages. For a fixed book, Original
 * shows the untouched file, to see what the fix changed.
 */
export function PreviewSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: d } = useCall("books.get", { id });
  const [s, setS] = useState<Saved>(load);
  const [original, setOriginal] = useState(false);
  const [chapter, setChapter] = useState(0);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const want = useRef<Want>({ at: "first" });
  const { data: p, error, isFetching } = useCall("books.preview", { id, chapter, original });
  const r = reader(s.reader);

  const set = (patch: Partial<Saved>) => {
    want.current = { at: "same", ratio: pages > 1 ? page / (pages - 1) : 0 };
    const next = { ...s, ...patch };
    setS(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  };

  const frame = useRef<HTMLIFrameElement>(null);
  const colours = useDeviceColours(r.eink);
  const doc = p ? withStyle(p.html, readerCss(r, s, colours)) : "";
  // The page count and turning belong to the document on screen; until a new one has laid out, wait for it.
  const shown = useRef("");
  const [laidOut, setLaidOut] = useState("");
  shown.current = doc;
  const ready = !!doc && laidOut === doc && !isFetching;

  // Count the screens once the chapter has laid out (and again when its fonts arrive), then land on the wanted one.
  const here = useRef(0);
  here.current = page;
  const measure = useCallback(
    (fresh: boolean) => {
      const w = frame.current?.contentWindow;
      const root = w?.document.scrollingElement;
      if (!w || !root) return;
      const n = Math.max(1, Math.round(root.scrollWidth / r.screen.w));
      const wanted = want.current;
      const target = !fresh ? here.current : wanted.at === "last" ? n - 1 : wanted.at === "same" ? Math.round(wanted.ratio * (n - 1)) : 0;
      setPages(n);
      setLaidOut(shown.current);
      setPage(Math.min(n - 1, target));
      w.scrollTo(Math.min(n - 1, target) * r.screen.w, 0);
    },
    [r.screen.w],
  );
  const onLoad = () => {
    measure(true);
    // Late fonts can change the count; stay on the page being read.
    void frame.current?.contentDocument?.fonts?.ready.then(() => measure(false));
  };
  // A page turned by a key or a tap slides in from the side it came from, as on newer Kindles and Kobos.
  const turning = useRef<1 | -1 | 0>(0);
  useEffect(() => {
    frame.current?.contentWindow?.scrollTo(page * r.screen.w, 0);
    const f = frame.current;
    if (!f || !turning.current) return;
    f.classList.remove("turn-next", "turn-back");
    void f.offsetWidth;
    f.classList.add(turning.current === 1 ? "turn-next" : "turn-back");
    turning.current = 0;
  }, [page, r.screen.w]);

  const last = (p?.chapters.length ?? 1) - 1;
  const turn = useCallback(
    (by: 1 | -1) => {
      if (!p || !ready) return;
      if (page + by >= 0 && page + by < pages) {
        turning.current = by;
        return setPage(page + by);
      }
      const c = p.chapter + by;
      if (c < 0 || c > last) return;
      want.current = { at: by === 1 ? "first" : "last" };
      setChapter(c);
    },
    [p, ready, page, pages, last],
  );
  const goChapter = (c: number) => {
    want.current = { at: "first" };
    setChapter(c);
  };
  const flip = (o: boolean) => {
    // The original may have a different reading order; keep the chapter number and start it from the top.
    want.current = { at: "first" };
    setOriginal(o);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("select, input")) return;
      const forward = e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !e.shiftKey);
      const back = e.key === "ArrowLeft" || e.key === "PageUp" || (e.key === " " && e.shiftKey);
      if (!forward && !back) return;
      e.preventDefault();
      turn(forward ? 1 : -1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [turn]);

  // Fit the device to the space it has, never larger than life.
  const stage = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const b = r.bezel;
  const fw = r.screen.w + b.left + b.right;
  const fh = r.screen.h + b.top + b.bottom;
  const scale = room.w ? Math.min(1, (room.w - 32) / fw, (room.h - 32) / fh) : 0;

  const fixed = !!d && d.report.changes.length > 0;
  const atStart = page === 0 && (p?.chapter ?? 0) === 0;
  const atEnd = page >= pages - 1 && (p?.chapter ?? 0) >= last;

  return (
    <Sheet label="Preview on a reader" onClose={onClose} className="preview" focusField={false}>
      <div className="pv-top">
        <div className="pv-t">
          <h2>Preview</h2>
          <span title={d?.title}>{d?.title}</span>
        </div>
        <select
          className="field"
          value={r.id}
          onChange={(e) => {
            set({ reader: e.target.value });
            e.target.blur(); // so the arrow keys go back to turning pages
          }}
          aria-label="Reader"
        >
          {READERS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        {fixed && (
          <div className="seg txt" role="group" aria-label="Which file">
            <button className={!original ? "on" : ""} onClick={() => flip(false)} aria-pressed={!original}>
              Fixed
            </button>
            <button className={original ? "on" : ""} onClick={() => flip(true)} aria-pressed={original}>
              Original
            </button>
          </div>
        )}
      </div>
      <div className="pv-body">
        <div className="pv-stage" ref={stage}>
          {error ? (
            <div className="empty">{error instanceof Error ? error.message : String(error)}</div>
          ) : (
            <div className="pv-fit" style={{ width: fw * scale, height: fh * scale }}>
              <div
                className={`pv-dev ${r.family}`}
                data-reader={r.id}
                style={{
                  width: fw,
                  height: fh,
                  padding: `${b.top}px ${b.right}px ${b.bottom}px ${b.left}px`,
                  borderRadius: b.radius,
                  transform: `scale(${scale})`,
                }}
              >
                <div className="pv-screen" style={{ width: r.screen.w, height: r.screen.h }}>
                  {doc && (
                    <iframe
                      ref={frame}
                      title="Page"
                      sandbox="allow-same-origin"
                      srcDoc={doc}
                      onLoad={onLoad}
                      style={{ width: r.screen.w, height: r.screen.h }}
                    />
                  )}
                  {/* Tap the left third to go back and anywhere else to go on, as on a reader. */}
                  <div className="pv-tap" onClick={(e) => turn(e.nativeEvent.offsetX < r.screen.w / 3 ? -1 : 1)} />
                </div>
              </div>
            </div>
          )}
        </div>
        <aside className="pv-side" aria-label="Reader settings">
          <div className="h">Text size</div>
          <div className="seg txt pv-size">
            <button onClick={() => set({ size: Math.max(1, s.size - 1) })} disabled={s.size <= 1} aria-label="Smaller text">
              <small>A</small>
            </button>
            <span>{s.size}</span>
            <button onClick={() => set({ size: Math.min(7, s.size + 1) })} disabled={s.size >= 7} aria-label="Larger text">
              A
            </button>
          </div>
          <div className="h">Margins</div>
          <Choice value={s.margins} set={(margins) => set({ margins })} options={{ narrow: "Narrow", normal: "Normal", wide: "Wide" }} label="Margins" />
          <div className="h">Line spacing</div>
          <Choice value={s.spacing} set={(spacing) => set({ spacing })} options={{ tight: "Tight", normal: "Normal", loose: "Loose" }} label="Line spacing" />
          <label className="pv-check">
            <input type="checkbox" checked={s.bookFonts} onChange={(e) => set({ bookFonts: e.target.checked })} />
            <span>
              Book’s own fonts
              <small>
                {r.family === "kindle" ? "Publisher Font on a Kindle" : r.family === "kobo" ? "Publisher Default on a Kobo" : "Original on Apple Books"}
              </small>
            </span>
          </label>
          <p className="pv-note">
            A close look at size, reflow and pictures. Each reader has its own typesetting, so line breaks can differ a little.
            {r.family === "kindle" && " Kindle also turns the book into its own format when it arrives."}
          </p>
        </aside>
      </div>
      <div className="sh-f">
        <select
          className="field pv-ch"
          value={p?.chapter ?? 0}
          onChange={(e) => {
            goChapter(Number(e.target.value));
            e.target.blur();
          }}
          aria-label="Chapter"
          disabled={!p || p.chapters.length < 2}
        >
          {p?.chapters.map((c, i) => (
            <option key={i} value={i}>
              {c.title}
            </option>
          ))}
        </select>
        <span className="note">{p && ready && `Page ${page + 1} of ${pages} in this part · part ${p.chapter + 1} of ${p.chapters.length}`}</span>
        <button className="ib" onClick={() => turn(-1)} disabled={atStart} aria-label="Previous page" title="Previous page (←)">
          <ChevronLeft size={16} />
        </button>
        <button className="ib" onClick={() => turn(1)} disabled={atEnd} aria-label="Next page" title="Next page (→ or Space)">
          <ChevronRight size={16} />
        </button>
        <button className="btn pri" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

function Choice<T extends string>({ value, set, options, label }: { value: T; set: (v: T) => void; options: Record<T, string>; label: string }) {
  return (
    <div className="seg txt" role="group" aria-label={label}>
      {(Object.keys(options) as T[]).map((k) => (
        <button key={k} className={value === k ? "on" : ""} aria-pressed={value === k} onClick={() => set(k)}>
          {options[k]}
        </button>
      ))}
    </div>
  );
}

/** The page's paper and ink, from the stylesheet's device colours (an iframe can't read our CSS variables). */
function useDeviceColours(eink: boolean) {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return eink ? { paper: v("--dev-eink-paper"), ink: v("--dev-eink-ink") } : { paper: v("--dev-lcd-paper"), ink: v("--dev-lcd-ink") };
}

/** The reader's CSS goes last in the head, so it wins where a reader overrides the book. */
function withStyle(html: string, css: string) {
  const tag = `<style id="magpie-reader">${css}</style>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, () => `${tag}</head>`) : html.replace(/<body/i, () => `<head>${tag}</head><body`);
}
