// App-shell calls that aren't core commands: updates and menu events.
// They live here, not scattered in screens, and do nothing in a browser.

// Updates (app/src-tauri/src/updates.rs), the way Argus does them: the app checks 5 s after
// launch and every six hours, downloads and installs a release in the background, then the
// Status bar offers Restart to update. The window only reads that status and asks for a
// check. In a browser there is nothing to update; `?update=ready` (or `downloading`,
// `current`, `error`, `off`) fakes a state for screenshots and tests.
export interface UpdateStatus {
  state: "off" | "idle" | "checking" | "downloading" | "ready" | "current" | "error";
  /** The running version. */
  current: string;
  /** The release found, while downloading or ready. */
  version: string | null;
  notes: string | null;
  done: number;
  total: number | null;
  /** When the last check finished, in Unix seconds. */
  checked_at: number | null;
  error: string | null;
}

const inApp = () => "__TAURI_INTERNALS__" in window;

const OFF: UpdateStatus = { state: "off", current: "", version: null, notes: null, done: 0, total: null, checked_at: null, error: null };
const fake = new URLSearchParams(location.search).get("update") as UpdateStatus["state"] | null;
const FAKE: UpdateStatus | null = fake
  ? {
      state: fake,
      current: "0.1.9",
      version: fake === "ready" || fake === "downloading" ? "0.1.10" : null,
      notes: "Series from Open Library: Look Up and Fix fill in a book’s series.\nRestart to update from the Status bar.",
      done: 4e6,
      total: 9e6,
      checked_at: Date.now() / 1000 - 120,
      error: fake === "error" ? "The update server didn’t answer." : null,
    }
  : null;

// One status for the whole window, kept in step with the app's by `update` events.
let status: UpdateStatus | null = FAKE ?? (inApp() ? null : OFF);
const listeners = new Set<(s: UpdateStatus) => void>();
const publish = (s: UpdateStatus) => {
  status = s;
  listeners.forEach((l) => l(s));
};

async function invoke<T>(cmd: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd);
}

let started = false;
function start() {
  if (started || !inApp() || FAKE) return;
  started = true;
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen<UpdateStatus>("update", (e) => publish(e.payload)))
    .then(async () => publish(await invoke<UpdateStatus>("update_status")))
    .catch((e) => console.warn("update status:", e));
}

/** Where updates stand; null until the app has said. */
export const updateStatus = () => (start(), status);

export function onUpdateStatus(l: (s: UpdateStatus) => void): () => void {
  start();
  listeners.add(l);
  return () => listeners.delete(l);
}

/** "Check for Updates…": returns at once; what the check finds arrives through onUpdateStatus. */
export async function checkForUpdates(): Promise<void> {
  if (FAKE) return publish({ ...FAKE, state: FAKE.state === "ready" ? "ready" : "current", checked_at: Date.now() / 1000 });
  if (!inApp()) return publish(OFF);
  // The reply is the state before the check, which only matters when this build can't update
  // or an update is already waiting.
  const before = await invoke<UpdateStatus>("check_for_updates");
  if (before.state === "off" || before.state === "ready") publish({ ...before });
}

/** "Restart to update": the new version is already installed, so a restart runs it. */
export async function restart() {
  if (inApp()) await invoke("restart_to_update");
}

/** "2 min ago" for a Unix time in seconds. */
export function ago(t: number | null): string {
  if (!t) return "never";
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Menu bar items (app/src-tauri/src/menu.rs) arrive as "menu" events with the item's id. */
export async function onMenu(handler: (id: string) => void): Promise<() => void> {
  if (!inApp()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>("menu", (e) => handler(e.payload));
}
