// App-shell calls that aren't core commands: updates and menu events.
// They live here, not scattered in screens, and do nothing in a browser.

export type UpdateStatus = { state: "off" | "idle" | "checking" | "downloading" | "ready" | "current" | "error"; version?: string; error?: string };

const inApp = () => "__TAURI_INTERNALS__" in window;

// One status for the whole window, so the launch check, the six-hourly check and
// Settings › Check Now share it and never download the same update twice.
let status: UpdateStatus = { state: "idle" };
const listeners = new Set<(s: UpdateStatus) => void>();
const set = (s: UpdateStatus) => {
  status = s;
  listeners.forEach((l) => l(s));
};

export const updateStatus = () => status;

export function onUpdateStatus(l: (s: UpdateStatus) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Check, and download in the background if there's a newer version. */
export async function checkForUpdates(): Promise<void> {
  if (!inApp() || import.meta.env.DEV) return set({ state: "off" });
  if (status.state === "checking" || status.state === "downloading" || status.state === "ready") return;
  set({ state: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return set({ state: "current" });
    set({ state: "downloading", version: update.version });
    await update.downloadAndInstall();
    set({ state: "ready", version: update.version });
  } catch (e) {
    set({ state: "error", error: String(e) });
  }
}

/** Quietly 5 s after launch, then every six hours, like Argus. */
export function checkForUpdatesNowAndThen(): () => void {
  if (!inApp() || import.meta.env.DEV) return () => {};
  const first = setTimeout(() => void checkForUpdates(), 5_000);
  const every = setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

export async function restart() {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Menu bar items (app/src-tauri/src/menu.rs) arrive as "menu" events with the item's id. */
export async function onMenu(handler: (id: string) => void): Promise<() => void> {
  if (!inApp()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>("menu", (e) => handler(e.payload));
}
