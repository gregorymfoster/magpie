// `just verify`: model-check verify/LibraryUndo.tla with TLC.
//
// Two runs of the same model. Today's code (Locked = TRUE) must keep every
// rule. The code before the fix (Locked = FALSE) must break each rule, one at a
// time, so the check is known to still be able to fail. Needs Java 11 or later;
// TLC itself is downloaded once into verify/.tla/ and checked by sha256.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "1.7.4";
const SHA256 = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const URL = `https://github.com/tlaplus/tlaplus/releases/download/v${VERSION}/tla2tools.jar`;

const dir = join(import.meta.dirname, "../verify");
const tools = join(dir, ".tla");
const jar = join(tools, `tla2tools-${VERSION}.jar`);
const RULES = ["EditsStay", "ShelvesStay", "EveryChangeUndoable"];

async function fetchTlc() {
  if (existsSync(jar)) return;
  mkdirSync(tools, { recursive: true });
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Couldn't download TLC ${VERSION} (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const sum = createHash("sha256").update(bytes).digest("hex");
  if (sum !== SHA256) throw new Error(`TLC ${VERSION} didn't match its checksum (${sum}).`);
  writeFileSync(jar, bytes);
}

function tlc(config: string): string {
  try {
    execFileSync("java", ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error("`just verify` needs Java 11 or later (on a Mac: brew install openjdk).");
  }
  const meta = join(tools, "states", config.replace(/\W/g, "-"));
  try {
    return execFileSync(
      "java",
      ["-XX:+UseParallelGC", "-cp", jar, "tlc2.TLC", "-workers", "auto", "-deadlock", "-cleanup", "-metadir", meta, "-config", config, "LibraryUndo.tla"],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? e);
  }
}

/** The before-fix config with only `rule` checked. */
function oneRule(rule: string): string {
  const cfg = readFileSync(join(dir, "LibraryUndo-before-fix.cfg"), "utf8");
  const only = cfg.replace(/INVARIANTS[\s\S]*$/, `INVARIANTS\n    TypeOK\n    ${rule}\n`);
  const path = join(tools, `before-fix-${rule}.cfg`);
  writeFileSync(path, only);
  return path;
}

await fetchTlc();
let failed = false;

const today = tlc("LibraryUndo.cfg");
const states = today.match(/(\d[\d,]*) distinct states found/)?.[1];
if (/Model checking completed\. No error has been found/.test(today)) console.log(`Today's code keeps every rule (${states} states checked).`);
else {
  failed = true;
  console.log("Today's code breaks a rule. TLC's output, with the shortest path to it:\n");
  console.log(today);
}

for (const rule of RULES) {
  const out = tlc(oneRule(rule));
  const steps = [...out.matchAll(/^State \d+: <(\w+)/gm)].map((m) => m[1]);
  if (new RegExp(`Invariant ${rule} is violated`).test(out)) console.log(`The code before the fix breaks ${rule}: ${steps.join(", ")}.`);
  else {
    failed = true;
    console.log(`The code before the fix should break ${rule} and didn't, so the check can no longer fail on it. TLC said:\n`);
    console.log(out);
  }
}

process.exit(failed ? 1 : 0);
