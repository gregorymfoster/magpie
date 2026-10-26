// Readers plugged in over USB. A Kobo mounts as a disk with a .kobo folder at
// its root. (A Kindle over USB wants AZW3, not EPUB, so Kindle goes by email.)

import { join, type Host } from "../host.ts";

export interface Device {
  /** The mount path, which is also its id while it stays plugged in. */
  id: string;
  kind: "kobo";
  name: string;
  path: string;
  /** Bytes free, or null when the disk won't say. */
  free: number | null;
}

export async function listDevices(host: Host): Promise<Device[]> {
  const out: Device[] = [];
  for (const v of await host.fs.list(host.env.volumes)) {
    if (!v.dir) continue;
    const path = join(host.env.volumes, v.name);
    if (await host.fs.exists(join(path, ".kobo")))
      out.push({ id: path, kind: "kobo", name: /^kobo ?e?reader$/i.test(v.name) ? "Kobo" : v.name, path, free: await host.fs.free(path) });
  }
  return out;
}
