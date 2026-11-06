import { useState } from "react";
import { Send, Mail, Usb, Smartphone } from "lucide-react";
import type { BookSummary, Job } from "@magpie/core";
import { useAction, useCall } from "../api.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { Cover } from "../components/Cover.tsx";
import { useToast } from "../components/Toasts.tsx";
import { plural, size } from "../format.ts";

/** Where books go: Apple Books (iPhone and iPad), Kindle by email, or a Kobo's mount path. */
export type Target = "books" | "kindle" | string;

const LAST = "magpie.sendTo";
/** Whatever was used last; Apple Books the first time, since it's where most reading happens. */
export function lastTarget(): Target {
  try {
    return localStorage.getItem(LAST) ?? "books";
  } catch {
    return "books";
  }
}

export function SendSheet({ books, onClose, onJob, prefer }: { books: BookSummary[]; onClose: () => void; onJob: (j: Job) => void; prefer?: Target }) {
  const { data: devices = [] } = useCall("devices.list");
  const { data: settings } = useCall("settings.get");
  const [chosen, setTarget] = useState<Target>(prefer ?? lastTarget());
  // A Kobo that was used last time but isn't plugged in now falls back to Apple Books.
  const target = chosen === "books" || chosen === "kindle" || devices.some((d) => d.path === chosen) ? chosen : "books";
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const act = useAction();
  const toast = useToast();

  if (!books.length)
    return (
      <Sheet label="Select books to send" onClose={onClose}>
        <div className="sh-h">
          <h2>Select books to send</h2>
          <p>Choose one or more books in your Library, then press Send.</p>
        </div>
        <div className="sh-f">
          <button className="btn pri" onClick={onClose}>
            OK
          </button>
        </div>
      </Sheet>
    );

  const locked = books.filter((b) => b.state === "locked");
  const sending = books.filter((b) => b.state !== "locked");
  const needsAddress = target === "kindle" && settings && !settings.kindleAddress;
  const n = plural(sending.length, "book");
  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const ids = sending.map((b) => b.id);
      if (target === "books") {
        await act("send.books", { ids });
        toast({ message: `Added ${n} to Apple Books. With iCloud on for Books, ${sending.length === 1 ? "it reaches" : "they reach"} your iPhone and iPad.` });
        onClose();
      } else if (target === "kindle") {
        if (needsAddress) await act("settings.set", { kindleAddress: address });
        await act("send.kindle", { ids });
        toast({ message: "Your Mail draft is ready. Press Send in Mail." });
        onClose();
      } else {
        onJob(await act("send.kobo", { ids, device: target }));
      }
      try {
        localStorage.setItem(LAST, target);
      } catch {}
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const title = books.length === 1 ? books[0].title : plural(books.length, "book");
  const Option = ({ id, icon, name, detail, live }: { id: Target; icon: React.ReactNode; name: string; detail: string; live?: boolean }) => (
    <button className={"devopt" + (target === id ? " on" : "")} onClick={() => setTarget(id)} aria-pressed={target === id}>
      <span className={"radio" + (target === id ? " on" : "")} />
      {icon}
      <span className="bd">
        <b>{name}</b>
        <span>{detail}</span>
      </span>
      {live && <span className="snap live" />}
    </button>
  );
  return (
    <Sheet label={`Send ${title}`} onClose={onClose}>
      <div className="sh-h">
        <h2>Send {title}</h2>
        <p>Each reader gets the copy it reads best, made from the clean book the first time and kept.</p>
      </div>
      <div className="sh-b">
        <div className="devs">
          <Option
            id="books"
            icon={<Smartphone size={15} />}
            name="iPhone & iPad"
            detail="Added to Apple Books on this Mac, then to your iPhone and iPad through iCloud"
          />
          <Option
            id="kindle"
            icon={<Mail size={15} />}
            name="Kindle"
            detail={settings?.kindleAddress ? `Mail draft to ${settings.kindleAddress}` : "By email, from Apple Mail"}
          />
          {devices.map((d) => (
            <Option
              key={d.id}
              id={d.path}
              icon={<Usb size={15} />}
              name={d.name}
              detail={`Connected by USB${d.free !== null ? ` · ${size(d.free)} free` : ""}`}
              live
            />
          ))}
        </div>
        {target === "books" && (
          <p className="hint" style={{ margin: "10px 4px 12px", fontSize: 12, color: "var(--fg3)" }}>
            Books on your iPhone appear once iCloud is on for Books: on the Mac, Books › Settings › General › iCloud Drive; on the iPhone, Settings › Books ›
            iCloud Drive.
          </p>
        )}
        {needsAddress && (
          <div className="srow" style={{ borderBottom: 0, paddingTop: 0 }}>
            <div className="lab">
              <b>Your Send to Kindle address</b>
              <span>
                On amazon.com: Manage Your Content and Devices › Preferences › Personal Document Settings. Add your own email to the approved list there too.
              </span>
            </div>
            <input
              className="field"
              placeholder="name@kindle.com"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              aria-label="Send to Kindle address"
            />
          </div>
        )}
        {locked.length > 0 && (
          <p className="hint" style={{ margin: "10px 4px 12px", fontSize: 12, color: "var(--fg3)" }}>
            {locked.length === 1 ? `${locked[0].title} is` : `${plural(locked.length, "book")} are`} locked with DRM by the store that sold{" "}
            {locked.length === 1 ? "it" : "them"} and will stay behind.
          </p>
        )}
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <div className="files">
          {sending.map((b) => (
            <div key={b.id} className="file">
              <div style={{ width: 14 }}>
                <Cover b={b} />
              </div>
              <span
                style={{ flex: 1, minWidth: 0, fontFamily: "var(--serif)", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {b.title}
              </span>
              <span className="num" style={{ color: "var(--fg3)" }}>
                {size(b.size)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="sh-f">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn pri" disabled={busy || !sending.length || (needsAddress && !address.trim())} onClick={send}>
          <Send size={13} />
          {target === "books" ? `Add ${n} to Apple Books` : target === "kindle" ? "Make Mail draft" : `Send ${n}`}
        </button>
      </div>
    </Sheet>
  );
}
