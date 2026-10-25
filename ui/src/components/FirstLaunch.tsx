import { BookMarked, Library, Plus } from "lucide-react";
import { useAction, useCall, useTransport } from "../api.tsx";
import { plural } from "../format.ts";

/** An empty Library opens on the drop target, with Calibre offered right there if it's on this Mac. */
export function FirstLaunch({ onAdd, onCalibre }: { onAdd: () => void; onCalibre: () => void }) {
  const { data: calibre } = useCall("calibre.find");
  const { data: state } = useCall("app.state");
  const t = useTransport();
  const act = useAction();
  return (
    <div className="first">
      <div className="drop-target">
        <BookMarked size={28} strokeWidth={1.5} />
        <b>Drop your books here</b>
        <span>EPUB files or whole folders. Magpie copies each one in, fixes what’s broken, and keeps the original.</span>
        <button className="btn pri" style={{ marginTop: 10 }} onClick={onAdd}>
          <Plus size={13} />
          Add Books…
        </button>
      </div>
      {calibre ? (
        <button className="calibre" onClick={onCalibre}>
          <Library size={20} strokeWidth={1.5} />
          <p>
            <b>Bring in your Calibre library</b>
            <span>
              {plural(calibre.epubs, "EPUB book")} in {calibre.path.replace(/^\/(Users|home)\/[^/]+/, "~")}. Your Calibre library itself is never changed.
            </span>
          </p>
          <span className="btn">Bring in</span>
        </button>
      ) : (
        <button className="btn ghost" onClick={onCalibre}>
          Bring in a Calibre library…
        </button>
      )}
      <div className="loc">
        Your Library lives in {state?.library.path.replace(/^\/(Users|home)\/[^/]+/, "~")}.{" "}
        <button
          onClick={async () => {
            const p = await t.pickFolder("Choose where your Library lives");
            if (p) await act("library.use", { path: p });
          }}
        >
          Change
        </button>
      </div>
    </div>
  );
}

/** The remembered Library's disk isn't connected: say so, like Lightroom does when it loses its catalog. */
export function LostLibrary({ path }: { path: string }) {
  const t = useTransport();
  const act = useAction();
  const pick = async (title: string) => {
    const p = await t.pickFolder(title);
    if (p) await act("library.use", { path: p });
  };
  return (
    <div className="win">
      <div className="lost">
        <BookMarked size={30} strokeWidth={1.4} />
        <h1>Your Library can’t be found</h1>
        <p>It was here. If it’s on an external disk, plug the disk in and try again.</p>
        <code>{path}</code>
        <div className="acts">
          <button className="btn pri" onClick={() => location.reload()}>
            Try Again
          </button>
          <button className="btn" onClick={() => pick("Locate your Library")}>
            Locate Library…
          </button>
          <button className="btn" onClick={() => pick("Choose a folder for a new Library")}>
            New Library…
          </button>
        </div>
      </div>
    </div>
  );
}
