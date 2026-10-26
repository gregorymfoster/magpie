// Settings stored in the Library, so they travel with it. Each setting lives
// in exactly one section of the Settings sheet (ui/src/sheets/SettingsSheet.tsx).
// The Library's location is app-level and lives in config.json instead (see core.ts).

import { UserError } from "./errors.ts";

export interface Settings {
  /** Settings › Devices. name@kindle.com, from amazon.com › Manage Your Content and Devices › Preferences. */
  kindleAddress: string;
  /** Settings › General. Sort books onto shelves (Fiction, genres, vibes) as they come in. */
  organize: boolean;
}

export const DEFAULTS: Settings = {
  kindleAddress: "",
  organize: true,
};

export function validate(patch: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (patch.kindleAddress !== undefined) {
    const a = patch.kindleAddress.trim();
    if (a && !/^[^@\s]+@(free\.)?kindle\.(com|cn)$/i.test(a)) throw new UserError("not-kindle-address");
    out.kindleAddress = a;
  }
  if (patch.organize !== undefined) out.organize = !!patch.organize;
  return out;
}
