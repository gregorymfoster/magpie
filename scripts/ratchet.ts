// The design ratchet (from Argus): fails when UI code picks up things that
// erode the look. Each rule names where the right thing lives instead.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RULES: { name: string; test: RegExp; files: RegExp; allow?: RegExp; fix: string }[] = [
  { name: "stray colour", test: /#[0-9a-fA-F]{3,8}\b|rgba?\(/, files: /\.tsx$/, allow: /Cover\.tsx$/, fix: "use a CSS variable from ui/src/styles.css" },
  { name: "spinner", test: /\b(Spinner|Loader2?|animate-spin)\b/, files: /\.tsx$/, fix: "show a Progress row with a count and ETA (components/Progress.tsx)" },
  { name: "em-dash in copy", test: /—/, files: /\.(tsx|ts)$/, fix: "use a comma, parentheses or two sentences (house style)" },
];

const roots = ["ui/src", "core/src"];
const fails: string[] = [];
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const f of roots.flatMap(walk)) {
  const lines = readFileSync(f, "utf8").split("\n");
  for (const r of RULES) {
    if (!r.files.test(f) || r.allow?.test(f)) continue;
    lines.forEach((l, i) => {
      if (r.test.test(l) && !l.includes("ratchet-ok")) fails.push(`${f}:${i + 1}  ${r.name}: ${r.fix}`);
    });
  }
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
console.log("ratchet ok");
