// Score Magpie's fixers against the corpus and against Calibre's convert-again trick.
//
//   npm run corpus && npm run baseline   # once: build corpus, run Calibre + EPUBCheck
//   npm run bench                        # every change: run fixers, score, write bench/results/
//
// A file counts as fixed only if every check passes. A crash, a timeout or a
// missing output is a failure, never a skip.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fixAndAccept } from "../core/src/fix.ts";
import { Book, textOf, decodeUtf8 } from "../core/src/epub.ts";

const ROOT = join(import.meta.dirname, "..");
const CORPUS = join(ROOT, "corpus");
const OUT = join(ROOT, "bench", "out");
const RESULTS = join(ROOT, "bench", "results");

interface Row {
  file: string;
  defects: string[] | null;
  categories?: string[];
  title?: string;
  author?: string;
  language?: string;
  split: "tuning" | "heldout" | "real";
  style: string;
}

interface Check {
  id: string;
  severity: string;
  message: string;
  path: string | null;
}

// Errors we assume make Send to Kindle reject a file or lose content. This is a
// guess until the email test confirms it; everything else EPUBCheck reports
// (mostly schema nits) Kindle is known to tolerate.
const KINDLE_CRITICAL = /^(PKG-|RSC-00[1-3]|RSC-0(07|08|11|16|20)|OPF-0(30|31|33|49|50|74))/;

const rows: Row[] = JSON.parse(readFileSync(join(CORPUS, "manifest.json"), "utf8"));

// ---------------------------------------------------------------- run Magpie
mkdirSync(OUT, { recursive: true });
const runs = new Map<string, { ok: boolean; ms: number; changes: number; error?: string }>();
for (const r of rows) {
  const dst = join(OUT, "magpie", r.file);
  mkdirSync(dirname(dst), { recursive: true });
  const t = performance.now();
  try {
    const res = fixAndAccept(readFileSync(join(CORPUS, "files", r.file)));
    writeFileSync(dst, res.bytes);
    runs.set(r.file, {
      ok: true,
      ms: performance.now() - t,
      changes: res.report.changes.length,
      error: res.report.errors.map((e) => `${e.fixer}: ${e.error}`).join("; ") || undefined,
    });
  } catch (e) {
    runs.set(r.file, { ok: false, ms: performance.now() - t, changes: 0, error: String(e) });
  }
}

// ---------------------------------------------------------------- EPUBCheck
function epubcheck(paths: string[]): Map<string, Check[] | "crash"> {
  const p = spawnSync(join(ROOT, "tools", "epubcheck-batch", "run.sh"), { input: paths.join("\n"), maxBuffer: 1 << 30, encoding: "utf8" });
  return readChecks(p.stdout);
}
function readChecks(jsonl: string): Map<string, Check[] | "crash"> {
  const m = new Map<string, Check[] | "crash">();
  for (const line of jsonl.split("\n").filter(Boolean)) {
    const d = JSON.parse(line);
    m.set(d.file, d.crash ? "crash" : d.messages);
  }
  return m;
}
const magpiePaths = rows.filter((r) => runs.get(r.file)!.ok).map((r) => join(OUT, "magpie", r.file));
const magpieChecks = epubcheck(magpiePaths);

const systems: Record<string, { path: (f: string) => string; checks: Map<string, Check[] | "crash">; ran: (f: string) => boolean }> = {
  original: { path: (f) => join(CORPUS, "files", f), checks: readChecks(readFileSync(join(CORPUS, "baseline", "original.jsonl"), "utf8")), ran: () => true },
};
for (const v of ["calibre", "calibre-v3"]) {
  const runsFile = join(CORPUS, "baseline", `${v}-runs.jsonl`);
  if (!existsSync(runsFile)) continue;
  const ok = new Set(
    readFileSync(runsFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r) => r.ok)
      .map((r) => r.file),
  );
  systems[v] = {
    path: (f) => join(CORPUS, "baseline", v, f),
    checks: readChecks(readFileSync(join(CORPUS, "baseline", `${v}.jsonl`), "utf8")),
    ran: (f) => ok.has(f),
  };
}
systems.magpie = { path: (f) => join(OUT, "magpie", f), checks: magpieChecks, ran: (f) => runs.get(f)!.ok };

// ---------------------------------------------------------------- inspect outputs
interface Inspect {
  title: string;
  author: string;
  language: string;
  cover: { declared: boolean; bytes: number };
  headings: string[];
}

function inspect(bytes: Uint8Array): Inspect | null {
  try {
    const book = Book.load(bytes);
    if (!book.opfPath) return null;
    const opf = book.opf();
    const coverMeta = opf.metas().find((m) => m.getAttribute("name") === "cover");
    const metaItem = coverMeta ? opf.itemById(coverMeta.getAttribute("content") ?? "") : undefined;
    const propItem = opf.items().find((i) => /\bcover-image\b/.test(i.getAttribute("properties") ?? ""));
    // Kindle reads the meta tag; an EPUB 3 file also needs the property for other readers.
    const item = opf.epub3 ? (metaItem && propItem === metaItem ? metaItem : (metaItem ?? undefined)) : metaItem;
    const declared = !!item && /^image\//.test(item.getAttribute("media-type") ?? "") && book.has(opf.itemPath(item));
    const headings: string[] = [];
    for (const ref of opf.itemrefs()) {
      const it = opf.itemById(ref.getAttribute("idref") ?? "");
      if (!it || !book.has(opf.itemPath(it))) continue;
      for (const m of decodeUtf8(book.files.get(opf.itemPath(it))!).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)) headings.push(m[1].replace(/<[^>]+>/g, "").trim());
    }
    return {
      title: textOf(opf.dc("title")[0]),
      author: textOf(opf.dc("creator")[0]),
      language: textOf(opf.dc("language")[0]),
      cover: { declared, bytes: declared ? book.files.get(opf.itemPath(item!))!.length : 0 },
      headings,
    };
  } catch {
    return null;
  }
}

const norm = (s = "") =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const cleanTwin = (r: Row) => rows.find((x) => x.split !== "real" && !x.defects?.length && x.title === r.title && x.style === r.style);
const twinInfo = new Map<string, Inspect>();
for (const r of rows) if (r.defects && !r.defects.length) twinInfo.set(r.file, inspect(readFileSync(join(CORPUS, "files", r.file)))!);

interface Verdict {
  ran: boolean;
  strict: boolean; // no EPUBCheck errors
  kindle: boolean; // no errors we believe Kindle rejects
  cover: boolean;
  metadata: boolean; // title, author, language match the truth
  content: boolean; // every chapter is still there, in order
  ready: boolean; // kindle + cover + metadata + content: what a reader would notice
  fixed: boolean; // ready, and also passes EPUBCheck with no errors
  errorIds: string[];
}

function judge(sys: string, r: Row): Verdict {
  const s = systems[sys];
  const fail: Verdict = {
    ran: false,
    strict: false,
    kindle: false,
    cover: false,
    metadata: false,
    content: false,
    ready: false,
    fixed: false,
    errorIds: ["NO-OUTPUT"],
  };
  if (!s.ran(r.file)) return fail;
  const checks = s.checks.get(s.path(r.file));
  if (!checks || checks === "crash") return { ...fail, ran: true, errorIds: ["EPUBCHECK-CRASH"] };
  const errs = checks.filter((c) => c.severity === "ERROR" || c.severity === "FATAL");
  const errorIds = [...new Set(errs.map((c) => c.id))];
  const strict = errs.length === 0;
  const kindle = !errs.some((c) => c.severity === "FATAL" || KINDLE_CRITICAL.test(c.id));
  if (r.split === "real") return { ran: true, strict, kindle, cover: true, metadata: true, content: true, ready: kindle, fixed: strict, errorIds };
  const info = inspect(readFileSync(s.path(r.file)));
  if (!info) return { ...fail, ran: true, errorIds };
  const twin = twinInfo.get(cleanTwin(r)!.file)!;
  const cover = info.cover.declared && info.cover.bytes >= 0.3 * twin.cover.bytes;
  const metadata = norm(info.title) === norm(r.title) && norm(info.author) === norm(r.author) && info.language.toLowerCase().startsWith(r.language!);
  let want = twin.headings;
  if (r.defects?.includes("manifest_missing_file")) {
    // the chapter is genuinely gone; the rest must survive in order
    want = want.filter((h) => info.headings.includes(h));
    if (want.length !== twin.headings.length - 1) want = twin.headings;
  }
  const content = JSON.stringify(info.headings) === JSON.stringify(want);
  const ready = kindle && cover && metadata && content;
  return { ran: true, strict, kindle, cover, metadata, content, ready, fixed: ready && strict, errorIds };
}

// ---------------------------------------------------------------- score
const sysNames = Object.keys(systems);
const verdicts: Record<string, Record<string, Verdict>> = {};
for (const r of rows) {
  verdicts[r.file] = {};
  for (const s of sysNames) verdicts[r.file][s] = judge(s, r);
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "n/a");
const lines: string[] = [];
const table = (title: string, subset: Row[], keys: (keyof Verdict)[]) => {
  lines.push(`\n### ${title} (${subset.length} files)\n`);
  lines.push(`| | ${sysNames.join(" | ")} |`, `|---|${sysNames.map(() => "---").join("|")}|`);
  for (const k of keys) lines.push(`| ${k} | ${sysNames.map((s) => pct(subset.filter((r) => verdicts[r.file][s][k]).length, subset.length)).join(" | ")} |`);
};
const broken = rows.filter((r) => r.defects?.length);
const clean = rows.filter((r) => r.defects && !r.defects.length);
const real = rows.filter((r) => r.split === "real");
const allKeys: (keyof Verdict)[] = ["fixed", "ready", "strict", "kindle", "cover", "metadata", "content"];
lines.push(
  `# Magpie bench\n\nGenerated ${new Date().toISOString()}. "ready" means a reader would see a good book: no Kindle-critical errors (our guess at the list, pending the email test), the right cover declared, correct title, author and language, and every chapter in order. "fixed" is ready plus zero EPUBCheck errors.`,
);
table(
  "Broken files, held-out books (the number that counts)",
  broken.filter((r) => r.split === "heldout"),
  allKeys,
);
table(
  "Broken files, tuning books",
  broken.filter((r) => r.split === "tuning"),
  allKeys,
);
table("Clean files (should stay clean: anything below 100% is a regression)", clean, allKeys);
table("Real-world files (no ground truth; EPUBCheck only)", real, ["strict", "kindle"]);

lines.push("\n### Fixed rate by defect category (all broken files, single-defect copies only)\n");
lines.push(`| category | n | ${sysNames.join(" | ")} |`, `|---|---|${sysNames.map(() => "---").join("|")}|`);
const single = broken.filter((r) => r.defects!.length === 1);
for (const d of [...new Set(single.map((r) => r.defects![0]))].sort()) {
  const sub = single.filter((r) => r.defects![0] === d);
  lines.push(`| ${d} | ${sub.length} | ${sysNames.map((s) => pct(sub.filter((r) => verdicts[r.file][s].fixed).length, sub.length)).join(" | ")} |`);
}

const crashes = [...runs].filter(([, v]) => !v.ok || v.error);
lines.push(
  `\n### Magpie runtime\n\nMedian ${median([...runs.values()].map((v) => v.ms)).toFixed(0)} ms per book. ${crashes.length} crash(es)${crashes.length ? ":\n" + crashes.map(([f, v]) => `- ${f}: ${v.error}`).join("\n") : "."}`,
);

const unfixed = broken.filter((r) => !verdicts[r.file].magpie.fixed);
lines.push(`\n### Magpie misses (${unfixed.length})\n`);
for (const r of unfixed) {
  const v = verdicts[r.file].magpie;
  const why = (["strict", "cover", "metadata", "content"] as const).filter((k) => !v[k]).join(", ");
  lines.push(`- ${r.file} [${r.defects!.join(", ")}] failed: ${why}${v.errorIds.length ? ` (${v.errorIds.join(", ")})` : ""}`);
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
}

// Committed results always carry the Calibre comparison; without Calibre
// installed, results go to bench/out so the committed ones stay intact.
const dest = systems.calibre ? RESULTS : OUT;
mkdirSync(dest, { recursive: true });
writeFileSync(join(dest, "summary.md"), lines.join("\n") + "\n");
writeFileSync(join(dest, "verdicts.json"), JSON.stringify(verdicts, null, 1));
console.log(lines.join("\n"));

// The gate: every broken file fixed, every clean file left clean, nothing crashed.
const regressions = [...unfixed, ...clean.filter((r) => !verdicts[r.file].magpie.fixed)];
if (regressions.length || crashes.length) {
  console.error(`\nbench FAILED: ${regressions.length} not fixed, ${crashes.length} crashed`);
  process.exit(1);
}
console.error(`\nbench ok: wrote ${join(dest, "summary.md")}`);
