import { useState } from "react";
import { Send, Mail, Usb } from "lucide-react";
import type { BookSummary, Job } from "@magpie/core";
import { useAction, useCall } from "../api.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { Cover } from "../components/Cover.tsx";
import { useToast } from "../components/Toasts.tsx";
import { plural, size } from "../format.ts";

export function SendSheet({ books, onClose, onJob, prefer }: { books: BookSummary[]; onClose: () => void; onJob: (j: Job) => void; prefer?: string }) {
  const { data: devices = [] } = useCall("devices.list");
  const { data: settings } = useCall("settings.get");
  const [target, setTarget] = useState<string>(prefer ?? "kindle");
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

  const needsAddress = target === "kindle" && settings && !settings.kindleAddress;
  const send = async () => {
    setBusy(true);
    setError("");
    try {
      if (target === "kindle") {
        if (needsAddress) await act("settings.set", { kindleAddress: address });
        await act("send.kindle", { ids: books.map((b) => b.id) });
        toast({ message: "Your Mail draft is ready. Press Send in Mail." });
        onClose();
      } else {
        onJob(await act("send.kobo", { ids: books.map((b) => b.id), device: target }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const title = books.length === 1 ? books[0].title : plural(books.length, "book");
  return (
    <Sheet label={`Send ${title}`} onClose={onClose}>
      <div className="sh-h">
        <h2>Send {title}</h2>
        <p>Kindle gets an email from your own Mail. A Kobo gets a copy over USB in Kobo’s own format.</p>
      </div>
      <div className="sh-b">
        <div className="devs">
          <button className={"devopt" + (target === "kindle" ? " on" : "")} onClick={() => setTarget("kindle")}>
            <span className={"radio" + (target === "kindle" ? " on" : "")} />
            <Mail size={15} />
            <span className="bd">
              <b>Kindle</b>
              <span>{settings?.kindleAddress ? `Mail draft to ${settings.kindleAddress}` : "By email, from Apple Mail"}</span>
            </span>
          </button>
          {devices.map((d) => (
            <button key={d.id} className={"devopt" + (target === d.path ? " on" : "")} onClick={() => setTarget(d.path)}>
              <span className={"radio" + (target === d.path ? " on" : "")} />
              <Usb size={15} />
              <span className="bd">
                <b>{d.name}</b>
                <span>Connected by USB{d.free !== null ? ` · ${size(d.free)} free` : ""}</span>
              </span>
              <span className="snap live" />
            </button>
          ))}
          {!devices.length && <div style={{ fontSize: 12, color: "var(--fg3)", padding: "0 4px" }}>Plug in a Kobo with its cable and it appears here.</div>}
        </div>
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
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <div className="files">
          {books.map((b) => (
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
        <button className="btn pri" disabled={busy || (needsAddress && !address.trim())} onClick={send}>
          <Send size={13} />
          {target === "kindle" ? "Make Mail draft" : `Send ${plural(books.length, "book")}`}
        </button>
      </div>
    </Sheet>
  );
}
