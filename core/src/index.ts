// The core's public interface. Hosts, the CLI and the UI import from here only.

export { createCore, COMMANDS, type Core, type AppState, type Api, type CommandName, type Args, type Result, type CoreEvent } from "./core.ts";
export type { Host, HostEnv, Db, SqlValue } from "./host.ts";
export { fix, fixAndAccept, newPlan, accept, FIXERS, ENGINE, type FixPlan, type FixReport, type Fixed, type Change } from "./fix.ts";
export { readInfo, suggest, patchFor, type BookInfo, type InfoPatch, type Suggestion } from "./info.ts";
export { Book, BookError } from "./epub.ts";
export type { BookSummary, BookDetail, BookState, AddOutcome, ListQuery } from "./library/library.ts";
export type { Job, JobResult } from "./jobs.ts";
export type { Device } from "./send/devices.ts";
export type { Settings } from "./settings.ts";
export { explain } from "./errors.ts";
export { toKepub } from "./send/kepub.ts";
