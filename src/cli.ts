// node --experimental-strip-types src/cli.ts in.epub [out.epub]
import { readFileSync, writeFileSync } from "node:fs";
import { fixEpub } from "./index.ts";

const [input, output = input.replace(/\.epub$/i, "") + ".fixed.epub"] = process.argv.slice(2);
if (!input) {
  console.error("usage: magpie in.epub [out.epub]");
  process.exit(2);
}
const r = fixEpub(readFileSync(input));
for (const c of r.changes) console.log(`- ${c.message}`);
for (const e of r.errors) console.error(`! ${e.fixer} failed: ${e.error}`);
if (!r.changes.length) console.log("Nothing to fix.");
writeFileSync(output, r.bytes);
console.log(`Wrote ${output}`);
