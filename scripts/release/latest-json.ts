// Builds the updater manifest (latest.json) for one release. Installed copies read it from
// https://github.com/gregorymfoster/magpie/releases/latest/download/latest.json.
// Usage: node scripts/release/latest-json.ts --version 0.2.0 --tag v0.2.0 --bundle Magpie_0.2.0_aarch64.app.tar.gz \
//          --sig path/to/bundle.sig --platform darwin-aarch64 [--platform darwin-x86_64] [--notes "..."]
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const REPO = "gregorymfoster/magpie";

export interface LatestJsonInput {
  version: string;
  tag: string;
  bundle: string;
  signature: string;
  platforms: string[];
  notes?: string;
  pubDate?: Date;
  repo?: string;
}

export function latestJson({ version, tag, bundle, signature, platforms, notes = "", pubDate = new Date(), repo = REPO }: LatestJsonInput) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`not a semver version: ${version}`);
  if (!signature.trim()) throw new Error("empty updater signature");
  if (!platforms.length) throw new Error("no platforms");
  const entry = { signature: signature.trim(), url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(bundle)}` };
  return {
    version,
    notes,
    pub_date: pubDate.toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms: Object.fromEntries(platforms.map((p) => [p, entry])),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: a } = parseArgs({
    options: {
      version: { type: "string" },
      tag: { type: "string" },
      bundle: { type: "string" },
      sig: { type: "string" },
      notes: { type: "string" },
      platform: { type: "string", multiple: true },
    },
  });
  const json = latestJson({
    version: a.version!,
    tag: a.tag!,
    bundle: a.bundle!,
    signature: readFileSync(a.sig!, "utf8"),
    platforms: a.platform ?? [],
    notes: a.notes,
  });
  process.stdout.write(JSON.stringify(json, null, 2) + "\n");
}
