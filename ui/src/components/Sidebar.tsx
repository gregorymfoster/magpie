import { useEffect, useRef, useState } from "react";
import { Library, AlertCircle, Trash2, Mail, Usb, Folder, Layers, User, ChevronRight, Smartphone } from "lucide-react";
import type { AppState, Device, Groups, Job } from "@magpie/core";
import { DoneCheck, jobProgress } from "./Progress.tsx";
import { Count } from "./Motion.tsx";
import { plural, tilde } from "../format.ts";

export type View = "all" | "work" | "removed" | "books" | "kindle" | `kobo:${string}` | `tag:${string}` | `author:${string}` | `series:${string}`;

type Section = "series" | "authors";
const FEW_AUTHORS = 8;

const stored = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem("magpie.closed") ?? "{}");
  } catch {
    return {};
  }
};

export function Sidebar({
  state,
  devices,
  groups,
  view,
  setView,
  onJob,
}: {
  state: AppState;
  devices: Device[];
  groups?: Groups;
  view: View;
  setView: (v: View) => void;
  /** Reopens a job's sheet, from the footer's "Added 24 books". */
  onJob?: (id: number) => void;
}) {
  const [closed, setClosed] = useState(stored);
  const [allAuthors, setAllAuthors] = useState(false);
  const toggle = (s: Section) =>
    setClosed((c) => {
      const next = { ...c, [s]: !c[s] };
      try {
        localStorage.setItem("magpie.closed", JSON.stringify(next));
      } catch {}
      return next;
    });
  const Row = ({ id, icon, label, count, hot, sub }: { id: View; icon?: React.ReactNode; label: string; count?: number; hot?: boolean; sub?: boolean }) => (
    <button className={"row" + (view === id ? " on" : "") + (sub ? " sub" : "")} onClick={() => setView(id)} aria-current={view === id ? "page" : undefined}>
      {icon}
      <span className="lbl">{label}</span>
      {count !== undefined && (
        <span className={"ct" + (hot && count ? " hot" : "")}>
          <Count n={count} />
        </span>
      )}
    </button>
  );
  const Sec = ({ id, label, children }: { id: Section; label: string; children: React.ReactNode }) => (
    <>
      <button className={"sec tog" + (closed[id] ? " shut" : "")} onClick={() => toggle(id)} aria-expanded={!closed[id]}>
        {label}
        <ChevronRight size={11} strokeWidth={2.2} />
      </button>
      {!closed[id] && children}
    </>
  );
  const running = state.jobs.find((j) => j.state === "running" || j.state === "queued");
  const finished = useFinished(running, state.jobs);
  const authors = groups ? [...groups.authors].sort((a, b) => b.count - a.count || 0) : [];
  const shownAuthors = allAuthors
    ? (groups?.authors ?? [])
    : authors.slice(0, FEW_AUTHORS).sort((a, b) => groups!.authors.indexOf(a) - groups!.authors.indexOf(b));
  const i = { size: 14, strokeWidth: 1.7 };
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
        <Row id="all" icon={<Library {...i} />} label="All Books" count={state.counts.all} />
        <Row id="work" icon={<AlertCircle {...i} />} label="Needs Work" count={state.counts.work} hot />
        {state.counts.removed > 0 && <Row id="removed" icon={<Trash2 {...i} />} label="Removed" count={state.counts.removed} />}
        {groups && groups.series.length > 0 && (
          <Sec id="series" label="Series">
            {groups.series.map((s) => (
              <Row key={s.name} id={`series:${s.name}`} icon={<Layers {...i} />} label={s.name} count={s.count} />
            ))}
          </Sec>
        )}
        {groups && groups.authors.length > 0 && (
          <Sec id="authors" label="Authors">
            {shownAuthors.map((a) => (
              <Row key={a.name} id={`author:${a.name}`} icon={<User {...i} />} label={a.name} count={a.count} />
            ))}
            {groups.authors.length > FEW_AUTHORS && (
              <button className="row more" onClick={() => setAllAuthors((s) => !s)}>
                <span className="lbl">{allAuthors ? "Show fewer" : `Show all ${groups.authors.length}`}</span>
              </button>
            )}
          </Sec>
        )}
        <div className="sec">Send to</div>
        <Row id="books" icon={<Smartphone {...i} />} label="iPhone & iPad" />
        <Row id="kindle" icon={<Mail {...i} />} label="Kindle" />
        {devices.map((d) => (
          <Row key={d.id} id={`kobo:${d.path}`} icon={<Usb {...i} />} label={d.name} />
        ))}
      </nav>
      <div className="side-foot">
        {running ? (
          <div className="job">{jobProgress(running)}</div>
        ) : finished ? (
          <button className="finished" onClick={() => onJob?.(finished.id)} title="Show what happened">
            <DoneCheck size={14} />
            <span>{finishedLabel(finished)}</span>
          </button>
        ) : (
          <span className="path">
            <Folder size={12} />
            <span title={state.library.path} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {tilde(state.library.path)}
            </span>
          </span>
        )}
      </div>
    </aside>
  );
}

/** When the running job ends, the footer says how it went for a few seconds before going back to the Library's path. */
function useFinished(running: Job | undefined, jobs: Job[]): Job | null {
  const last = useRef<number | null>(null);
  const [finished, setFinished] = useState<Job | null>(null);
  useEffect(() => {
    if (running) {
      last.current = running.id;
      setFinished(null);
      return;
    }
    const ended = jobs.find((j) => j.id === last.current && j.state === "done");
    last.current = null;
    if (!ended) return;
    setFinished(ended);
    const t = setTimeout(() => setFinished(null), 4000);
    return () => clearTimeout(t);
    // Only a change of running job matters; the job list changes on every tick.
  }, [running?.id]);
  return finished;
}

function finishedLabel(j: Job): string {
  const n = (o: string) => j.results.filter((r) => r.outcome === o).length;
  if (j.kind === "kobo") return `Sent ${plural(n("sent"), "book")}`;
  if (j.kind === "lookup") return `Found details for ${plural(n("found"), "book")}`;
  if (j.kind === "organize") return `Sorted ${plural(j.total, "book")}`;
  return `Added ${plural(n("added"), "book")}`;
}
