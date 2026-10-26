// Downloads the sorting model (MODEL in core/src/organize/bert.ts) into
// models/, checking each file's sha256. CI runs it before building the app and
// before `just check`; run it once locally with `just model`. The files never
// enter git: they're 35 MB and they're someone else's (MIT, BAAI and Xenova).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MODEL } from "../core/src/organize/bert.ts";

const dir = join(import.meta.dirname, "..", "models", MODEL.name);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
let failed = false;
for (const [file, want] of Object.entries(MODEL.files)) {
  const path = join(dir, file);
  if (existsSync(path) && want && sha(readFileSync(path)) === want) continue;
  const res = await fetch(`${MODEL.source}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = sha(bytes);
  console.log(`${file} ${bytes.length} bytes sha256 ${got}`);
  if (want && got !== want) {
    console.error(`${file}: expected sha256 ${want}`);
    failed = true;
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}
if (failed) process.exit(1);
console.log(`Model ready in ${dir}`);
