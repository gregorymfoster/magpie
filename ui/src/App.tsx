// The window: sidebar | toolbar over content | inspector, status bar below.
// Every state can be opened by URL for screenshots and tests:
//   ?view=review&layout=list&sel=3,4&sheet=settings&palette=flannel&theme=dark

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, Globe, LayoutGrid, List as ListIcon, PanelRight, Plus, Search, Send, Wand2 } from "lucide-react";
import type { BookSummary, Job } from "@magpie/core";
import { useAction, useCall, useTransport } from "./api.tsx";
import { Sidebar, type View } from "./components/Sidebar.tsx";
import { Grid, List } from "./components/Books.tsx";
import { Inspector, type Act } from "./components/Inspector.tsx";
import { Toasts, useToast } from "./components/Toasts.tsx";
import { FirstLaunch, LostLibrary } from "./components/FirstLaunch.tsx";
import { JobSheet } from "./sheets/JobSheet.tsx";
import { ReviewSheet } from "./sheets/ReviewSheet.tsx";
import { LookupSheet } from "./sheets/LookupSheet.tsx";
import { SendSheet } from "./sheets/SendSheet.tsx";
import { EditSheet } from "./sheets/EditSheet.tsx";
import { PreviewSheet } from "./sheets/PreviewSheet.tsx";
import { SettingsSheet, type Section } from "./sheets/SettingsSheet.tsx";
import { onMenu } from "./shell.ts";
import { plural } from "./format.ts";

type SheetState =
  | { type: "job"; id: number }
  | { type: "review" }
  | { type: "lookup" }
  | { type: "send"; ids: number[]; prefer?: string }
  | { type: "edit"; id: number }
  | { type: "preview"; id: number }
  | { type: "settings"; section?: Section }
  | null;

const url = new URLSearchParams(location.search);
const stored = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};

export function App() {
  return (
    <Toasts>
      <Window />
    </Toasts>
  );
}

function Window() {
  const t = useTransport();
  const act = useAction();
  const toast = useToast();
  const { data: state, error } = useCall("app.state");
  const [palette, setPaletteState] = useState(url.get("palette") ?? stored("magpie.palette", "warm"));
  const [view, setView] = useState<View>((url.get("view") as View) ?? "all");
  const [layout, setLayout] = useState<"grid" | "list">((url.get("layout") as "list") ?? (stored("magpie.layout", "grid") as "grid"));
  const [sel, setSel] = useState<number[]>(url.get("sel")?.split(",").map(Number) ?? []);
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState<SheetState>(() => initialSheet(sel));
  const [drag, setDrag] = useState(false);
  const [showInsp, setShowInsp] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastClick = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    if (url.get("theme")) document.documentElement.dataset.theme = url.get("theme")!;
  }, [palette]);
  const setPalette = (p: string) => {
    setPaletteState(p);
    try {
      localStorage.setItem("magpie.palette", p);
    } catch {}
  };
  useEffect(() => {
    try {
      localStorage.setItem("magpie.layout", layout);
    } catch {}
  }, [layout]);

  const open = state?.library.status === "open";
  const query = view === "review" ? { state: "review" as const } : view === "removed" ? { removed: true } : groupQuery(view);
  const { data: books = [] } = useCall("books.list", { ...query, search: q || undefined }, { enabled: open });
  const { data: groups } = useCall("library.groups", undefined, { enabled: open });
  // Nothing tells the window a reader was plugged in, so look every few seconds (it's one folder listing).
  const { data: devices = [] } = useCall("devices.list", undefined, { enabled: open, every: 3000 });
  const kobo = view.startsWith("kobo:") ? view.slice(5) : null;
  const { data: onKobo } = useCall("devices.books", { device: kobo ?? "" }, { enabled: open && !!kobo, every: 3000 });
  const items = useMemo(() => {
    if (view === "recent") return books.filter((b) => Date.now() - Date.parse(b.addedAt) < 14 * 864e5);
    if (kobo) return books.filter((b) => onKobo?.ids.includes(b.id));
    return books;
  }, [books, view, kobo, onKobo]);
  const chosen = useMemo(() => books.filter((b) => sel.includes(b.id)), [books, sel]);

  const importPaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      try {
        const job = await act("books.import", { paths });
        setSheet({ type: "job", id: job.id });
      } catch (e) {
        toast({ message: e instanceof Error ? e.message : String(e), error: true });
      }
    },
    [act, toast],
  );

  const run = useCallback(
    async (a: string) => {
      const ids = sel.length ? sel : [];
      try {
        switch (a) {
          case "add":
            return importPaths((await t.pickBooks()) ?? []);
          case "find":
            return searchRef.current?.focus();
          case "grid":
          case "list":
            return setLayout(a);
          case "send":
            return setSheet({ type: "send", ids, prefer: kobo ?? undefined });
          case "review":
            return setSheet({ type: "review" });
          case "settings":
            return setSheet({ type: "settings" });
          case "updates":
            return setSheet({ type: "settings", section: "Updates" });
          case "edit":
            return ids.length === 1 && setSheet({ type: "edit", id: ids[0] });
          case "preview": {
            const b = ids.length === 1 && books.find((x) => x.id === ids[0]);
            return b && b.state !== "locked" && setSheet({ type: "preview", id: b.id });
          }
          case "selectAll":
            return setSel(items.map((b) => b.id));
          case "remove": {
            if (!ids.length || view === "removed") return;
            await act("books.remove", { ids });
            setSel([]);
            return toast({
              message: ids.length === 1 ? "Moved to Removed" : `Moved ${plural(ids.length, "book")} to Removed`,
              undo: () => void act("history.undo"),
            });
          }
          case "restore":
            await act("books.restore", { ids });
            return setSel([]);
          case "undo": {
            const r = await act("history.undo");
            return toast({ message: r.undone ? `Undid ${r.undone.toLowerCase()}` : "Nothing to undo" });
          }
          case "diagnostics":
            await t.copyText(await act("app.diagnostics"));
            return toast({ message: "Diagnostics copied. No titles or contents are included." });
          case "calibre": {
            const found = await act("calibre.find");
            const path = found?.path ?? (await t.pickFolder("Choose your Calibre library folder"));
            if (!path) return;
            const job = await act("calibre.import", { path });
            return setSheet({ type: "job", id: job.id });
          }
        }
      } catch (e) {
        toast({ message: e instanceof Error ? e.message : String(e), error: true });
      }
    },
    [sel, t, items, books, view, act, toast, importPaths],
  );

  // Keyboard. In the app WebKit sees a shortcut before the menu bar does, so handling it here
  // (and preventing the default) means the menu item fires only when it's clicked.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select");
      if (sheet && e.key !== "Escape") return;
      if (e.key === "Escape") return setSel([]);
      // Space is Quick Look in Finder, so it previews here too.
      if (e.key === " " && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        return void run("preview");
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const map: Record<string, string> = { k: "find", o: "add", "1": "grid", "2": "list", i: "edit", y: "preview", ",": "settings" };
      if (!typing) Object.assign(map, { a: "selectAll", z: "undo", Backspace: "remove" });
      const id = e.shiftKey && e.key.toLowerCase() === "s" ? "send" : map[e.key];
      if (id) {
        e.preventDefault();
        void run(id);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [run, sheet]);
  useEffect(() => {
    // onMenu resolves later; if this effect is already cleaned up by then, drop the listener at once
    // instead of leaving a second one that runs every menu item twice.
    let off: (() => void) | null = null;
    let gone = false;
    void onMenu((id) => {
      // Edit › Undo and Select All are ours, but in a text field they belong to the text.
      const field = document.activeElement?.closest?.("input, textarea");
      if (field && id === "undo") return document.execCommand("undo");
      if (field && id === "selectAll") return (field as HTMLInputElement).select();
      if (field && id === "remove") return;
      void run(id);
    }).then((f) => (gone ? f() : (off = f)));
    return () => {
      gone = true;
      off?.();
    };
  }, [run]);

  // Drops: paths from Finder in the app, File objects in a browser.
  useEffect(() => t.onFileDrop({ hover: setDrag, drop: (p) => void importPaths(p) }), [t, importPaths]);
  const depth = useRef(0);
  const dnd =
    t.kind === "browser"
      ? {
          onDragEnter: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            depth.current++;
            setDrag(true);
          },
          onDragOver: (e: React.DragEvent) => e.dataTransfer.types.includes("Files") && e.preventDefault(),
          onDragLeave: () => {
            depth.current = Math.max(0, depth.current - 1);
            if (!depth.current) setDrag(false);
          },
          onDrop: async (e: React.DragEvent) => {
            e.preventDefault();
            depth.current = 0;
            setDrag(false);
            await importPaths(await t.stage([...e.dataTransfer.files]));
          },
        }
      : {};

  const onSel = (id: number, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    else if (e.shiftKey && lastClick.current !== null) {
      const ids = items.map((b) => b.id);
      const [a, c] = [ids.indexOf(lastClick.current), ids.indexOf(id)].sort((x, y) => x - y);
      setSel(ids.slice(a, c + 1));
    } else setSel([id]);
    lastClick.current = id;
  };
  const inspect: Act = (a) => void run(a);

  if (error) return <div className="lost">{String(error)}</div>;
  if (!state) return <div className="win" />;
  if (state.library.status === "missing") return <LostLibrary path={state.library.path} />;

  const job = sheet?.type === "job" ? state.jobs.find((j) => j.id === sheet.id) : undefined;
  const title =
    { all: "All Books", review: "Needs Review", recent: "Recently Added", removed: "Removed", kindle: "Kindle" }[view as string] ??
    devices.find((d) => `kobo:${d.path}` === view)?.name ??
    (/^(tag|author|series):/.test(view) ? view.slice(view.indexOf(":") + 1) : undefined) ??
    "Kobo";
  const empty = state.counts.all === 0 && !q && view === "all";

  let body: React.ReactNode;
  if (empty) body = <FirstLaunch onAdd={() => void run("add")} onCalibre={() => void run("calibre")} />;
  else if (!items.length)
    body = (
      <div className="empty">
        <b>
          {q ? "No matches" : view === "review" ? "Every book’s details are settled" : kobo ? "Nothing from your Library is on this Kobo yet" : "Nothing here"}
        </b>
        {q
          ? `No titles, authors or series contain “${q}”.`
          : view === "review"
            ? "Books whose title or author Magpie had to guess wait here for you."
            : kobo
              ? "Select books in All Books and press Send. They arrive in Kobo’s own format."
              : "Drop ebook files anywhere on this window to add them."}
      </div>
    );
  else
    body = (
      <>
        {view === "review" && (
          <div className="pane" style={{ paddingBottom: 0, maxWidth: "none" }}>
            <div className="lead" style={{ marginBottom: 0 }}>
              <p>
                <b>{plural(items.length, "book")} with details to check</b>
                <span>
                  Magpie found a better title or author inside {items.length === 1 ? "this book" : "these books"}. Nothing is written until you accept it.
                </span>
              </p>
              <button className="btn pri" onClick={() => setSheet({ type: "review" })}>
                Review details
              </button>
            </div>
          </div>
        )}
        {view === "kindle" && <KindleCard onSend={() => void run("send")} />}
        {layout === "list" ? (
          <List items={items} sel={sel} onSel={onSel} onOpen={(id) => setSheet({ type: "edit", id })} />
        ) : (
          <Grid items={items} sel={sel} onSel={onSel} onOpen={(id) => setSheet({ type: "edit", id })} />
        )}
      </>
    );

  return (
    <div className="win" {...dnd}>
      <div className="wbody">
        <Sidebar
          state={state}
          devices={devices}
          view={view}
          groups={groups}
          onSort={() => void act("library.organize").catch((e) => toast({ message: e instanceof Error ? e.message : String(e), error: true }))}
          setView={(v) => {
            setView(v);
            setSel([]);
          }}
        />
        <div className="main">
          <div className="tb" data-tauri-drag-region>
            <div className="ttl" data-tauri-drag-region>
              <h1>{title}</h1>
              <span>{plural(items.length, "book")}</span>
            </div>
            <div className="seg hide-sm">
              <button className={layout === "grid" ? "on" : ""} title="Covers (⌘1)" aria-label="Show covers" onClick={() => setLayout("grid")}>
                <LayoutGrid size={13} />
              </button>
              <button className={layout === "list" ? "on" : ""} title="List (⌘2)" aria-label="Show list" onClick={() => setLayout("list")}>
                <ListIcon size={14} />
              </button>
            </div>
            <label className="search">
              <Search size={13} />
              <input ref={searchRef} placeholder="Search books" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
              <kbd>⌘K</kbd>
            </label>
            <button className="btn hide-sm" onClick={() => void run("add")} title="Add books (⌘O)">
              <Plus size={13} />
              Add
            </button>
            <button className="btn" onClick={() => setSheet({ type: "lookup" })} title="Look up missing details on Open Library">
              <Globe size={13} />
              <span className="hide-sm">Look Up</span>
            </button>
            {state.counts.review > 0 && (
              <button className="btn pri" onClick={() => setSheet({ type: "review" })}>
                <Wand2 size={13} />
                Review {state.counts.review}
              </button>
            )}
            <button className="btn" onClick={() => void run("send")} title="Send to a device (⇧⌘S)">
              <Send size={13} />
              <span className="hide-sm">Send</span>
            </button>
            <button className={"ib" + (showInsp ? " on" : "")} title="Inspector" aria-label="Toggle inspector" onClick={() => setShowInsp((s) => !s)}>
              <PanelRight size={15} />
            </button>
          </div>
          <div className="split">
            <div
              className="content"
              onClick={(e) => {
                const el = e.target as HTMLElement;
                if (el === e.currentTarget || el.classList.contains("grid")) setSel([]);
              }}
            >
              {body}
            </div>
            {showInsp && !empty && (
              <Inspector
                chosen={chosen}
                act={inspect}
                onTag={(name) => {
                  setView(`tag:${name}`);
                }}
              />
            )}
          </div>
        </div>
        {drag && (
          <div className="dropover">
            <div>
              <BookMarked size={26} />
              <b>Drop to add to Magpie</b>
              <span>Every book is copied in and repaired on the way. The files you drop stay where they are.</span>
            </div>
          </div>
        )}
        {sheet?.type === "job" && job && (
          <JobSheet job={job} reviewCount={state.counts.review} onClose={() => setSheet(null)} onReview={() => setSheet({ type: "review" })} />
        )}
        {sheet?.type === "review" && <ReviewSheet onClose={() => setSheet(null)} />}
        {sheet?.type === "lookup" && <LookupSheet onClose={() => setSheet(null)} onJob={(j: Job) => setSheet({ type: "job", id: j.id })} />}
        {sheet?.type === "send" && (
          <SendSheet
            books={books.filter((b) => sheet.ids.includes(b.id))}
            prefer={sheet.prefer}
            onClose={() => setSheet(null)}
            onJob={(j: Job) => setSheet({ type: "job", id: j.id })}
          />
        )}
        {sheet?.type === "edit" && <EditSheet id={sheet.id} onClose={() => setSheet(null)} />}
        {sheet?.type === "preview" && <PreviewSheet id={sheet.id} onClose={() => setSheet(null)} />}
        {sheet?.type === "settings" && <SettingsSheet start={sheet.section} palette={palette} setPalette={setPalette} onClose={() => setSheet(null)} />}
      </div>
      <StatusBar books={books} state={state} />
    </div>
  );
}

/** Shelves, vibes, tags, authors and series in the sidebar are each a filter on the list. */
function groupQuery(view: View): { tag?: string; author?: string; series?: string } {
  const m = view.match(/^(tag|author|series):(.*)$/s);
  return m ? { [m[1]]: m[2] } : {};
}

function initialSheet(sel: number[]): SheetState {
  const s = url.get("sheet");
  if (s === "review") return { type: "review" };
  if (s === "settings") return { type: "settings", section: (url.get("section") as Section) ?? undefined };
  if (s === "send") return { type: "send", ids: sel };
  if (s === "edit" && sel.length) return { type: "edit", id: sel[0] };
  if (s === "preview" && sel.length) return { type: "preview", id: sel[0] };
  return null;
}

function KindleCard({ onSend }: { onSend: () => void }) {
  const { data: s } = useCall("settings.get");
  return (
    <div className="dev">
      <span className="ico">
        <i />
      </span>
      <div className="bd">
        <b>Kindle</b>
        <span>{s?.kindleAddress ? `Send to Kindle by email · ${s.kindleAddress}` : "Send to Kindle by email. Add your address the first time you send."}</span>
      </div>
      <button className="btn" onClick={onSend}>
        <Send size={13} />
        Send books…
      </button>
    </div>
  );
}

function StatusBar({ books, state }: { books: BookSummary[]; state: NonNullable<ReturnType<typeof useCall<"app.state">>["data"]> }) {
  return (
    <div className="status">
      <span>
        {plural(state.counts.all, "book")}
        {state.counts.review ? ` · ${state.counts.review} to review` : ""}
        {books.length !== state.counts.all ? ` · ${books.length} shown` : ""}
      </span>
      <span className="sp" />
      <span className="keys">
        <kbd>⌘K</kbd>Search
      </span>
      <span className="keys">
        <kbd>⌘O</kbd>Add
      </span>
      <span className="keys">
        <kbd>⇧⌘S</kbd>Send
      </span>
      {state.undo && (
        <span className="keys">
          <kbd>⌘Z</kbd>Undo {state.undo.toLowerCase()}
        </span>
      )}
    </div>
  );
}
