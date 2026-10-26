import { Library, AlertCircle, Clock, Trash2, Mail, Usb, Folder } from "lucide-react";
import type { AppState, Device } from "@magpie/core";
import { jobProgress } from "./Progress.tsx";
import { tilde } from "../format.ts";

export type View = "all" | "review" | "recent" | "removed" | "kindle" | `kobo:${string}`;

export function Sidebar({ state, devices, view, setView }: { state: AppState; devices: Device[]; view: View; setView: (v: View) => void }) {
  const Row = ({ id, icon, label, count, hot }: { id: View; icon: React.ReactNode; label: string; count?: number; hot?: boolean }) => (
    <button className={"row" + (view === id ? " on" : "")} onClick={() => setView(id)} aria-current={view === id ? "page" : undefined}>
      {icon}
      <span>{label}</span>
      {count !== undefined && <span className={"ct" + (hot && count ? " hot" : "")}>{count.toLocaleString("en-US")}</span>}
    </button>
  );
  const running = state.jobs.find((j) => j.state === "running" || j.state === "queued");
  return (
    <aside className="side">
      <div className="side-top" data-tauri-drag-region>
        <div className="lights">
          <i />
          <i />
          <i />
        </div>
      </div>
      <nav className="side-scroll" aria-label="Library">
        <div className="sec">Library</div>
        <Row id="all" icon={<Library size={14} strokeWidth={1.7} />} label="All Books" count={state.counts.all} />
        <Row id="review" icon={<AlertCircle size={14} strokeWidth={1.7} />} label="Needs Review" count={state.counts.review} hot />
        <Row id="recent" icon={<Clock size={14} strokeWidth={1.7} />} label="Recently Added" />
        {state.counts.removed > 0 && <Row id="removed" icon={<Trash2 size={14} strokeWidth={1.7} />} label="Removed" count={state.counts.removed} />}
        <div className="sec">Devices</div>
        <Row id="kindle" icon={<Mail size={14} strokeWidth={1.7} />} label="Kindle" />
        {devices.map((d) => (
          <Row key={d.id} id={`kobo:${d.path}`} icon={<Usb size={14} strokeWidth={1.7} />} label={d.name} />
        ))}
      </nav>
      <div className="side-foot">
        {running ? (
          <div className="job">{jobProgress(running)}</div>
        ) : (
          <>
            <Folder size={12} />
            <span title={state.library.path} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {tilde(state.library.path)}
            </span>
          </>
        )}
      </div>
    </aside>
  );
}
