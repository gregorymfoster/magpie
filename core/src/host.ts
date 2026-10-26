// The Host: everything the core needs from the machine it runs on, and
// nothing else. The core never imports node:fs or Tauri; it is handed a Host.
// Two adapters exist: the Node host (cli/src/node-host.ts) for the CLI, tests,
// the bench and `magpie serve`, and the Tauri host (ui/src/transport/tauri.ts
// over app/src-tauri) that ships. One contract suite (core/test/host-contract.ts)
// runs against each so they can't quietly disagree.
//
// Every path is absolute. Every call is async because in the app each one
// crosses from the worker to Rust.

export interface Host {
  fs: {
    read(path: string): Promise<Uint8Array>;
    /** Atomic (write to a temp file, then rename). Creates parent folders. */
    write(path: string, data: Uint8Array): Promise<void>;
    /** Copy without passing the bytes through the core. Creates parent folders. */
    copy(from: string, to: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    /** Entries directly inside a folder; [] when it doesn't exist. */
    list(dir: string): Promise<{ name: string; dir: boolean }[]>;
    mkdir(path: string): Promise<void>;
    /** A file or a whole folder. No error when it's already gone. */
    remove(path: string): Promise<void>;
    /** Renames within a disk; creates parent folders. */
    move(from: string, to: string): Promise<void>;
    /** Bytes free on the disk holding this path, or null when unknown. */
    free(path: string): Promise<number | null>;
  };
  sqlite: {
    open(path: string, opts?: { readonly?: boolean }): Promise<Db>;
  };
  /** Open a file in its default app. */
  open(path: string): Promise<void>;
  /**
   * Open a new, unsent message in the person's mail app with these files
   * attached. Never sends: they press Send. (Mail opens an .eml as a received
   * message it won't send, so this goes through Mail itself.)
   */
  mail(draft: MailDraft): Promise<void>;
  env: HostEnv;
}

export interface MailDraft {
  to: string;
  subject: string;
  body: string;
  /** Absolute paths of files to attach. */
  attachments: string[];
}

export interface HostEnv {
  /** ~ */
  home: string;
  /** Where app-level config lives (the current Library's location). */
  config: string;
  /** Scratch space that may be wiped between launches. */
  temp: string;
  /** Where removable disks appear: /Volumes on a Mac. */
  volumes: string;
  /** "0.1.0" */
  version: string;
}

export type SqlValue = string | number | null | Uint8Array;

export interface Db {
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number; lastId: number }>;
  /** Several statements in one transaction: all of them happen, or none. */
  batch(statements: { sql: string; params?: SqlValue[] }[]): Promise<void>;
  /** Plain SQL with no parameters, e.g. a migration script. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export const join = (...parts: string[]) =>
  parts
    .filter(Boolean)
    .join("/")
    .replace(/\/{2,}/g, "/");

export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const parentOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/"))) || "/";
