// Settings (⌘,). One page per section; each setting lives in exactly one place.

import { useEffect, useState } from "react";
import { still } from "../motion.ts";
import { useAction, useCall, useTransport } from "../api.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { useToast } from "../components/Toasts.tsx";
import { ago, checkForUpdates, restart } from "../shell.ts";
import { useUpdate } from "../components/Updates.tsx";
import { plural, tilde } from "../format.ts";

export const SECTIONS = ["General", "Library", "Devices", "Privacy", "Updates"] as const;
export type Section = (typeof SECTIONS)[number];

export function SettingsSheet({
  onClose,
  start = "General",
  palette,
  setPalette,
}: {
  onClose: () => void;
  start?: Section;
  palette: string;
  setPalette: (p: string) => void;
}) {
  const [sec, setSec] = useState<Section>(start);
  return (
    <Sheet wide label="Settings" onClose={onClose}>
      <div className="sh-h">
        <h2>Settings</h2>
      </div>
      <div className="set">
        <nav aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button key={s} className={"row" + (s === sec ? " on" : "")} onClick={() => setSec(s)}>
              <span>{s}</span>
            </button>
          ))}
        </nav>
        <div className="pane2">
          {sec === "General" && <General palette={palette} setPalette={setPalette} />}
          {sec === "Library" && <LibraryPage onClose={onClose} />}
          {sec === "Devices" && <Devices />}
          {sec === "Privacy" && <Privacy />}
          {sec === "Updates" && <Updates />}
        </div>
      </div>
      <div className="sh-f">
        <button className="btn pri" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

const Row = ({ title, sub, children }: { title: string; sub: string; children?: React.ReactNode }) => (
  <div className="srow">
    <div className="lab">
      <b>{title}</b>
      <span>{sub}</span>
    </div>
    {children}
  </div>
);

function General({ palette, setPalette }: { palette: string; setPalette: (p: string) => void }) {
  const { data: s } = useCall("app.state");
  return (
    <>
      <Row title="Palette" sub="Warm study is the default. Flannel & silver is cooler, with a maroon thread under the toolbar.">
        <select className="field" style={{ width: 170 }} value={palette} onChange={(e) => setPalette(e.target.value)} aria-label="Palette">
          <option value="warm">Warm study</option>
          <option value="flannel">Flannel &amp; silver</option>
        </select>
      </Row>
      <Row title="Light and dark" sub="Magpie follows your Mac. Change it in System Settings › Appearance." />
      <Row title="Version" sub={`Magpie ${s?.version ?? ""}. Free and open source under the MIT license.`} />
    </>
  );
}

/** The invisible work made visible: every fix Magpie has made, counting up as the page opens. */
function Repairs() {
  const { data } = useCall("library.repairs");
  const to = data?.repairs ?? 0;
  const [n, setN] = useState(0);
  useEffect(() => {
    if (still() || !to) return setN(to);
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 1200);
      setN(Math.round(to * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  if (!data) return null;
  return (
    <div className="tally">
      <b>{n.toLocaleString("en-US")}</b>
      <span>
        {to === 1 ? "repair" : "repairs"} Magpie has made to your books, from missing covers to broken tables of contents. Your originals were never touched.
      </span>
    </div>
  );
}

function LibraryPage({ onClose }: { onClose: () => void }) {
  const { data: s } = useCall("app.state");
  const { data: settings } = useCall("settings.get");
  const t = useTransport();
  const act = useAction();
  const toast = useToast();
  const move = async (title: string) => {
    const p = await t.pickFolder(title);
    if (!p) return;
    await act("library.use", { path: p });
    onClose();
  };
  return (
    <>
      <Repairs />
      <Row title="Location" sub={tilde(s?.library.path ?? "")}>
        <button className="btn" onClick={() => move("Open a Library")}>
          Open Other…
        </button>
        <button className="btn" onClick={() => move("Choose a folder for a new Library")}>
          New…
        </button>
      </Row>
      <Row title="Removed" sub={`${plural(s?.counts.removed ?? 0, "book")} waiting. Removed books are deleted for good after 30 days.`}>
        <button
          className="btn"
          disabled={!s?.counts.removed}
          onClick={async () => {
            const r = await act("books.purge");
            toast({ message: `Deleted ${plural(r.deleted, "book")} for good` });
          }}
        >
          Empty now
        </button>
      </Row>
      <Row
        title="Shelves"
        sub="Magpie sorts new books into Fiction or Nonfiction, a genre and a vibe, from the subjects they carry and a small model that runs on this Mac. Nothing is uploaded."
      >
        <select
          className="field"
          style={{ width: 120 }}
          aria-label="Sort new books"
          value={settings?.organize === false ? "off" : "on"}
          onChange={(e) => void act("settings.set", { organize: e.target.value === "on" })}
        >
          <option value="on">Sort new books</option>
          <option value="off">Don’t sort</option>
        </select>
        <button
          className="btn"
          onClick={async () => {
            const job = await act("library.organize", { again: true });
            toast({ message: job ? job.label : "Every book is already sorted" });
          }}
        >
          Sort All Again
        </button>
      </Row>
      <Row
        title="Originals"
        sub="Every book keeps the file it arrived as (EPUB, MOBI, PDF or whatever it was), untouched, inside the Library’s originals folder. Undo rebuilds from it."
      />
    </>
  );
}

function Devices() {
  const { data: s } = useCall("settings.get");
  const act = useAction();
  const [v, setV] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const value = v ?? s?.kindleAddress ?? "";
  return (
    <>
      <Row
        title="Send to Kindle address"
        sub="On amazon.com: Manage Your Content and Devices › Preferences › Personal Document Settings. Add the email you send from to the approved list there."
      >
        <input className="field" placeholder="name@kindle.com" value={value} onChange={(e) => setV(e.target.value)} aria-label="Send to Kindle address" />
        <button
          className="btn"
          disabled={v === null}
          onClick={async () => {
            try {
              await act("settings.set", { kindleAddress: value });
              setV(null);
              setErr("");
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          Save
        </button>
      </Row>
      {err && (
        <p className="err" role="alert">
          {err}
        </p>
      )}
      <Row
        title="Kobo"
        sub="Plug a Kobo in with its cable and it appears in the sidebar. Books are converted to Kobo’s own format (KEPUB) as they’re sent; your Library keeps the plain EPUB."
      />
    </>
  );
}

function Privacy() {
  return (
    <>
      <Row
        title="Your books stay on this Mac"
        sub="Magpie has no account and no server, and never uploads a book or a reading habit. It checks GitHub for a newer version of itself, and when you press Look Up it sends each book’s title, author and ISBN to Open Library. Nothing else leaves this Mac."
      />
      <Row
        title="Copy Diagnostics"
        sub="In the Magpie menu. It copies versions and counts for a bug report, and leaves out every title and every word of your books."
      />
    </>
  );
}

/** Settings › Updates, as in Argus: the version, what the last check found, Check Now or Restart to update, and what's new. */
function Updates() {
  const s = useUpdate();
  const busy = s?.state === "checking" || s?.state === "downloading";
  const line = !s
    ? "Checking how this build updates…"
    : {
        off: "This build doesn’t update itself (a dev or local build). Get the latest from magpie.gmfoster.com.",
        idle: "Magpie checks soon after launch and every six hours.",
        checking: "Checking…",
        downloading: `Downloading ${s.version}${s.total ? ` · ${Math.round((100 * s.done) / s.total)}%` : ""}. Keep working.`,
        ready: `Magpie ${s.version} is installed. Restart to use it; your books are saved.`,
        current: "You have the newest version.",
        error: `Couldn’t check: ${s.error ?? "unknown error"}. You can always get the latest from magpie.gmfoster.com.`,
      }[s.state];
  return (
    <>
      <Row title={s?.current ? `Magpie ${s.current}` : "Magpie"} sub={line}>
        {s?.state === "ready" ? (
          <button className="btn pri" onClick={() => void restart()} data-testid="settings-update-restart">
            Restart to Update
          </button>
        ) : (
          <button className="btn" disabled={busy || !s || s.state === "off"} onClick={() => void checkForUpdates()} data-testid="settings-update-check">
            Check Now
          </button>
        )}
      </Row>
      <Row title="Last checked" sub="Updates download in the background and wait for a restart. Nothing changes while you work.">
        <span className="upd-when" data-testid="settings-update-checked">
          {ago(s?.checked_at ?? null)}
        </span>
      </Row>
      {s?.notes && s.notes.trim() !== `Magpie ${s.version}` && (s.state === "ready" || s.state === "downloading") && (
        <div className="srow">
          <div className="lab">
            <b>What’s new in {s.version}</b>
            <pre className="update-notes">{s.notes}</pre>
          </div>
        </div>
      )}
    </>
  );
}
