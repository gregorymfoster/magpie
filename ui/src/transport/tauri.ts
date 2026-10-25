// The Mac app: the core runs in a Web Worker (core.worker.ts) so a book that
// blows up kills only the worker, and the window stays responsive. The
// worker can't reach Tauri's IPC, so its Host calls come back here and go
// to Rust (app/src-tauri/src/host.rs) with invoke.

import * as Comlink from "comlink";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import type { CoreEvent, HostEnv, SqlValue } from "@magpie/core";
import type { Transport } from "./index.ts";
import type { WorkerApi } from "./core.worker.ts";

/** Uint8Array can't ride in JSON to Rust, so blobs travel as {$b64}. */
const pack = (params: SqlValue[] = []) => params.map((p) => (p instanceof Uint8Array ? { $b64: b64(p) } : p));
const unpack = (rows: Record<string, unknown>[]) => {
  for (const r of rows) for (const k in r) if (r[k] && typeof r[k] === "object" && "$b64" in (r[k] as object)) r[k] = unb64((r[k] as { $b64: string }).$b64);
  return rows;
};
const b64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The flat Host the worker calls back into. Every method is one Rust command. */
export const tauriHost = {
  fsRead: async (path: string) => new Uint8Array(await invoke<ArrayBuffer>("fs_read", { path })),
  fsWrite: (path: string, data: Uint8Array) => invoke<void>("fs_write", data, { headers: { path: encodeURIComponent(path) } }),
  fsCopy: (from: string, to: string) => invoke<void>("fs_copy", { from, to }),
  fsExists: (path: string) => invoke<boolean>("fs_exists", { path }),
  fsList: (dir: string) => invoke<{ name: string; dir: boolean }[]>("fs_list", { dir }),
  fsMkdir: (path: string) => invoke<void>("fs_mkdir", { path }),
  fsRemove: (path: string) => invoke<void>("fs_remove", { path }),
  fsMove: (from: string, to: string) => invoke<void>("fs_move", { from, to }),
  fsFree: (path: string) => invoke<number | null>("fs_free", { path }),
  dbOpen: (path: string, readonly: boolean) => invoke<number>("db_open", { path, readonly }),
  dbAll: async (db: number, sql: string, params?: SqlValue[]) => unpack(await invoke<Record<string, unknown>[]>("db_all", { db, sql, params: pack(params) })),
  dbRun: (db: number, sql: string, params?: SqlValue[]) => invoke<{ changes: number; lastId: number }>("db_run", { db, sql, params: pack(params) }),
  dbBatch: (db: number, statements: { sql: string; params?: SqlValue[] }[]) =>
    invoke<void>("db_batch", { db, statements: statements.map((s) => ({ sql: s.sql, params: pack(s.params) })) }),
  dbExec: (db: number, sql: string) => invoke<void>("db_exec", { db, sql }),
  dbClose: (db: number) => invoke<void>("db_close", { db }),
  open: (path: string) => invoke<void>("open_path", { path }),
};
export type TauriHost = typeof tauriHost;

export async function tauriTransport(): Promise<Transport> {
  document.documentElement.dataset.shell = "app";
  const env = await invoke<HostEnv>("host_env");
  const worker = new Worker(new URL("./core.worker.ts", import.meta.url), { type: "module" });
  const core = Comlink.wrap<WorkerApi>(worker);
  await core.init(Comlink.proxy(tauriHost), env);
  const listeners = new Set<(e: CoreEvent) => void>();
  await core.subscribe(Comlink.proxy((e: CoreEvent) => listeners.forEach((l) => l(e))));

  return {
    kind: "app",
    call: (command, args) => core.call(command, args) as never,
    on(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    fileUrl: (path) => convertFileSrc(path),
    stage: async () => [],
    async pickBooks() {
      const r = await open({ multiple: true, title: "Add Books", filters: [{ name: "EPUB books", extensions: ["epub"] }] });
      return r ? (Array.isArray(r) ? r : [r]) : null;
    },
    async pickFolder(title) {
      const r = await open({ directory: true, title });
      return typeof r === "string" ? r : null;
    },
    onFileDrop({ hover, drop }) {
      const un = getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "enter" || e.payload.type === "over") hover(true);
        else if (e.payload.type === "leave") hover(false);
        else if (e.payload.type === "drop") {
          hover(false);
          drop(e.payload.paths);
        }
      });
      return () => void un.then((f) => f());
    },
    copyText: (t) => invoke("copy_text", { text: t }),
  };
}
