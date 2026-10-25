// The UI's only way to the core. Two adapters: http.ts (a browser against
// `magpie serve`, for development and Playwright) and tauri.ts (the Mac app,
// with the core in a Web Worker). Screens never know which one they have.

import type { Args, CommandName, CoreEvent, Result } from "@magpie/core";

export interface Transport {
  kind: "app" | "browser";
  call<K extends CommandName>(command: K, args?: Args<K>): Promise<Result<K>>;
  on(listener: (e: CoreEvent) => void): () => void;
  /** A URL the webview can load for a file on disk (a cover). */
  fileUrl(path: string): string;
  /** Files dropped or chosen in a browser, saved where the core can read them. */
  stage(files: File[]): Promise<string[]>;
  /** The Add Books… dialog. Null when cancelled. */
  pickBooks(): Promise<string[] | null>;
  /** Choose a folder (Locate Library…, New Library…, a Calibre library). Null when cancelled. */
  pickFolder(title: string): Promise<string | null>;
  /** Drops from Finder, with paths. Browser drops go through stage() instead. */
  onFileDrop(handlers: { hover(on: boolean): void; drop(paths: string[]): void }): () => void;
  copyText(text: string): Promise<void>;
}

let current: Transport | null = null;

export async function connect(): Promise<Transport> {
  if (current) return current;
  current = "__TAURI_INTERNALS__" in window ? await (await import("./tauri.ts")).tauriTransport() : (await import("./http.ts")).httpTransport();
  return current;
}
