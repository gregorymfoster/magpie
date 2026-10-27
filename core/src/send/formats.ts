// The file a reader gets. The Library keeps one clean EPUB per book; sending
// builds the right file for where it's going and keeps it (Library.deviceCopy),
// so nobody has to know what KEPUB is and the second send is instant.

import { toKepub } from "./kepub.ts";
import { toKindle } from "./kindle.ts";

export type Format = "kepub" | "kindle";

/** Bump when a transform changes what it writes, so kept copies are built again. */
export const FORMATS = 1;

export function build(format: Format, epub: Uint8Array): Uint8Array {
  return format === "kepub" ? toKepub(epub) : toKindle(epub);
}
