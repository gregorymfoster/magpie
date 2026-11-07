// Updates the way Argus does them (Greg, 2026-11-07), like Cursor and Claude: every fresh launch
// checks for a release, a quiet toast says once that one is downloading, then Restart to update
// sits at the right of the Status bar and a toast says so once. Check for Updates… (Magpie menu,
// Settings › Updates) says what it found. The app does the work (app/src-tauri/src/updates.rs);
// ui/src/shell.ts carries its status.

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { ArrowDownToLine, CircleArrowUp } from "lucide-react";
import { onUpdateStatus, restart, updateStatus, type UpdateStatus } from "../shell.ts";
import { useToast } from "./Toasts.tsx";

/** Where updates stand; null until the app has said. */
export function useUpdate(): UpdateStatus | null {
  const [s, setS] = useState(updateStatus);
  useEffect(() => {
    const off = onUpdateStatus(setS);
    setS(updateStatus());
    return off;
  }, []);
  return s;
}

/** The release notes, first few lines, for the Status bar's tooltip. */
export function notesLine(s: UpdateStatus): string {
  const lines = (s.notes ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);
  return [`Magpie ${s.version} · you have ${s.current}`, ...lines.filter((l) => l !== `Magpie ${s.version}`)].join("\n");
}

/**
 * Toasts: once when the background check finds a release, once when it's ready, and the outcome
 * of a Check for Updates… by hand. `asked` is set when a person asks, so the background checks
 * stay quiet.
 */
export function useUpdateToasts(asked: MutableRefObject<boolean>) {
  const toast = useToast();
  const s = useUpdate();
  const shown = useRef<string | null>(null);
  const found = useRef<string | null>(null);
  useEffect(() => {
    if (!s) return;
    const slot = "update";
    if (s.state === "ready" && shown.current !== s.version) {
      shown.current = s.version;
      asked.current = false;
      toast({
        slot,
        message: `Magpie ${s.version} is ready`,
        detail: "Restart to update. Your books are saved.",
        action: { label: "Restart", run: () => void restart() },
        seconds: 10,
      });
      return;
    }
    if (!asked.current) {
      // The launch check (and the one every six hours) found a release: say so once, quietly.
      if (s.state === "downloading" && s.version && found.current !== s.version) {
        found.current = s.version;
        toast({ slot, message: `Magpie ${s.version} is downloading`, detail: "Keep working. You can restart into it when it’s ready." });
      }
      return;
    }
    if (s.state === "checking") toast({ slot, message: "Checking for updates…" });
    else if (s.state === "downloading")
      toast({ slot, message: `Downloading Magpie ${s.version}`, detail: "Keep working. A Restart button appears when it’s ready." });
    else if (s.state === "current") toast({ slot, message: `Magpie ${s.current} is the newest version` });
    else if (s.state === "error") toast({ slot, message: "Couldn’t check for updates", detail: s.error ?? undefined, error: true });
    else if (s.state === "off") toast({ slot, message: "This build doesn’t update itself", detail: "Get the latest from magpie.gmfoster.com." });
    if (s.state !== "checking" && s.state !== "downloading") asked.current = false;
  }, [s, asked, toast]);
}

/** The update, at the right of the Status bar: downloading, then Restart to update. */
export function UpdateItem() {
  const s = useUpdate();
  if (s?.state === "downloading" && s.version) {
    const pct = s.total ? Math.round((100 * s.done) / s.total) : null;
    return (
      <span className="upd" data-testid="status-update" title={`Magpie ${s.version} is downloading. Keep working.`}>
        <ArrowDownToLine size={12} />
        <span>Downloading {s.version}</span>
        <span className="bar run">
          <i style={{ width: `${pct ?? 0}%` }} />
        </span>
      </span>
    );
  }
  if (s?.state !== "ready") return null;
  return (
    <button className="upd" onClick={() => void restart()} title={notesLine(s)} data-testid="update-restart">
      <CircleArrowUp size={12} />
      <span>Restart to update</span>
      <span className="ver">{s.version}</span>
    </button>
  );
}
