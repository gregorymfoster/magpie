// Settings stored in the Library, so they travel with it. Each setting lives
// in exactly one section of the Settings sheet (ui/src/sheets/SettingsSheet.tsx).
// The Library's location is app-level and lives in config.json instead (see core.ts).

export interface Settings {
  /** Settings › Devices. name@kindle.com, from amazon.com › Manage Your Content and Devices › Preferences. */
  kindleAddress: string;
}

export const DEFAULTS: Settings = {
  kindleAddress: "",
};

export function validate(patch: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (patch.kindleAddress !== undefined) {
    const a = patch.kindleAddress.trim();
    if (a && !/^[^@\s]+@(free\.)?kindle\.(com|cn)$/i.test(a)) throw new Error("That doesn't look like a Send to Kindle address. It ends in @kindle.com.");
    out.kindleAddress = a;
  }
  return out;
}
