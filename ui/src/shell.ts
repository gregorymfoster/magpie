// App-shell calls that aren't core commands: updates and menu events.
// They live here, not scattered in screens, and do nothing in a browser.

export type UpdateStatus = { state: "off" | "idle" | "checking" | "downloading" | "ready" | "current" | "error"; version?: string; error?: string };

const inApp = () => "__TAURI_INTERNALS__" in window;

/** Check, and download in the background if there's a newer version. */
export async function checkForUpdates(onStatus: (s: UpdateStatus) => void): Promise<void> {
  if (!inApp() || import.meta.env.DEV) return onStatus({ state: "off" });
  onStatus({ state: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return onStatus({ state: "current" });
    onStatus({ state: "downloading", version: update.version });
    await update.downloadAndInstall();
    onStatus({ state: "ready", version: update.version });
  } catch (e) {
    onStatus({ state: "error", error: String(e) });
  }
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
