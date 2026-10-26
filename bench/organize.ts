// How well does Magpie sort books onto shelves? Reads a Library (read-only),
// takes every book whose own subjects let the rules decide its kind and genre,
// hides those subjects, and asks the model alone. The rules' answer is the
// truth it's scored against. Prints accuracy and coverage across margins, so
// TUNING in core/src/organize/organize.ts rests on numbers.
//
//   node bench/organize.ts [--library ~/Books/Magpie] [--show]
//
// Needs the model (`just model`). Nothing is written, and titles stay on your screen.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { Book } from "../core/src/epub.ts";
import { Organizer, byRules, decide, readSubjects, readOpening, TUNING, type Scores } from "../core/src/organize/organize.ts";
import { GENRES, KINDS, VIBES } from "../core/src/organize/vocabulary.ts";
import { nodeHost } from "../cli/src/node-host.ts";

const { values: args } = parseArgs({ options: { library: { type: "string", default: join(homedir(), "Books/Magpie") }, show: { type: "boolean" } } });
const root = args.library!.replace(/^~/, homedir());
const embed = nodeHost().embed;
if (!embed) throw new Error("No model in models/. Run `just model` first.");

const db = new DatabaseSync(join(root, "library.db"), { readOnly: true });
const rows = db.prepare("SELECT title, description, file, plan, state FROM books WHERE removed_at IS NULL").all() as Record<string, string>[];
const org = new Organizer(embed);
const t0 = Date.now();
const books: { title: string; kind?: string; genres: string[]; scores: Scores | null }[] = [];
for (const r of rows) {
  let subjects: string[] = JSON.parse(r.plan).catalog?.subjects ?? [];
  let opening = "";
  const path = join(root, r.file);
  try {
    const book = Book.load(new Uint8Array(readFileSync(path)), { locked: "allow" });
    subjects = [...readSubjects(book), ...subjects];
    if (r.state !== "locked" && !r.description) opening = readOpening(book);
  } catch {}
  const truth = byRules({ title: r.title, subjects });
  // The model reads the blurb or opening and the title, never the subjects it's scored against.
  const scores = await org.scores({ title: r.title, description: r.description ?? undefined, subjects: [], opening });
  books.push({ title: r.title, kind: truth.kind?.name, genres: truth.genres.map((g) => g.name), scores });
}
const ms = (Date.now() - t0) / rows.length;
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%`.padStart(4) : " n/a");
const readable = books.filter((b) => b.scores);
console.log(
  `${rows.length} books, ${readable.length} with a blurb or opening to read, ${books.filter((b) => b.kind).length} whose subjects give a kind. ${ms.toFixed(0)} ms a book.\n`,
);

// Kind: how far apart the best fiction and nonfiction genres are.
console.log("Kind, model alone, by margin (right / named of books whose subjects say)");
const withKind = readable.filter((b) => b.kind);
for (const m of [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1]) {
  let told = 0,
    right = 0;
  for (const b of withKind) {
    const best = (k: string) => Math.max(...GENRES.map((g, i) => (g.kind === k ? b.scores!.genres[i] : -1)));
    const [f, n] = KINDS.map(best);
    if (Math.abs(f - n) < m) continue;
    told++;
    if ((f > n ? "Fiction" : "Nonfiction") === b.kind) right++;
  }
  console.log(`  margin ${m.toFixed(2)}: right ${pct(right, told)}, named ${pct(told, withKind.length)}`);
}

// Genre, given the right kind: how far the best genre beats the runner-up.
console.log("\nGenre within the right kind, model alone, by margin (top pick is one of the subjects' genres)");
const withGenre = readable.filter((b) => b.kind && b.genres.length);
for (const m of [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08]) {
  let told = 0,
    right = 0;
  for (const b of withGenre) {
    const ranked = GENRES.map((g, i) => ({ g, s: b.scores!.genres[i] }))
      .filter((x) => x.g.kind === b.kind)
      .sort((x, y) => y.s - x.s);
    if (ranked[0].s - ranked[1].s < m) continue;
    told++;
    if (b.genres.includes(ranked[0].g.name)) right++;
  }
  console.log(`  margin ${m.toFixed(2)}: right ${pct(right, told)}, named ${pct(told, withGenre.length)}`);
}

// Vibes have no truth to score against; show how often each would be given.
console.log("\nVibe similarity spread (top vibe per book)");
const tops = readable.map((b) => Math.max(...b.scores!.vibes)).sort((x, y) => x - y);
const q = (p: number) => tops[Math.floor(p * (tops.length - 1))]?.toFixed(3);
console.log(`  10% ${q(0.1)}  50% ${q(0.5)}  90% ${q(0.9)}  max ${q(1)}`);

console.log(`\nAs shipped (TUNING ${JSON.stringify(TUNING)}), with subjects hidden:`);
const counts = new Map<string, number>();
let none = 0;
for (const b of books) {
  const g = decide(byRules({ title: b.title, subjects: [] }), b.scores);
  if (!g.length) none++;
  for (const x of g) counts.set(x.name, (counts.get(x.name) ?? 0) + 1);
  if (args.show)
    console.log(
      `  ${g
        .map((x) => x.name)
        .join(", ")
        .padEnd(60)} | ${b.title.slice(0, 50)}  [subjects: ${b.kind ?? "?"} ${b.genres.join(", ")}]`,
    );
}
console.log(`  no shelf at all: ${none} of ${books.length}`);
console.log(
  `  given: ${[...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")}`,
);
void VIBES;
