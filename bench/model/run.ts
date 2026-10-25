// How often does a small local model get title and author right from the first
// pages alone, before any catalog lookup? Compares against Magpie's rule-based
// guesses on the same pages.
//
//   node --experimental-strip-types bench/model/run.ts [--model qwen2.5:1.5b] [--url http://localhost:11434/v1] [--n 50] [--split heldout]
//
// Talks to any OpenAI-compatible endpoint: Ollama (default), LM Studio, llama.cpp
// server, MLX. The browser (WebGPU) version will reuse the prompt and scorer.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Book } from "../../src/epub.ts";
import { frontMatter, guessTitle, guessAuthor } from "../../src/fixers/metadata.ts";

const { values: args } = parseArgs({
  options: {
    model: { type: "string", default: "qwen2.5:1.5b" },
    url: { type: "string", default: "http://localhost:11434/v1" },
    n: { type: "string", default: "50" },
    split: { type: "string", default: "heldout" },
  },
});

const ROOT = join(import.meta.dirname, "..", "..");
const rows = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8")) as {
  file: string; title: string; author: string; split: string; defects: string[] | null;
}[];
// One file per book: the clean copy, but with the OPF's title and author ignored, so only the pages count.
const sample = rows.filter((r) => r.defects && !r.defects.length && (args.split === "all" || r.split === args.split)).slice(0, Number(args.n));

export const PROMPT = `You are a librarian. Below are the first pages of an ebook. Identify the book.
Reply with JSON only: {"title": string|null, "author": string|null, "series": string|null, "series_index": number|null, "language": string|null, "isbn": string|null}.
Use null for anything the pages don't state. Do not guess from memory.`;

const norm = (s?: string | null) => (s ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function ask(pagesText: string): Promise<{ title?: string; author?: string } | null> {
  const res = await fetch(`${args.url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: args.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: PROMPT }, { role: "user", content: pagesText.slice(0, 6000) }],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const body = await res.json();
  try {
    return JSON.parse(body.choices[0].message.content.replace(/^```(json)?|```$/g, ""));
  } catch {
    return null;
  }
}

let model = { title: 0, author: 0, both: 0, invalid: 0 };
let rules = { title: 0, author: 0, both: 0 };
const details: unknown[] = [];
for (const r of sample) {
  const book = Book.load(readFileSync(join(ROOT, "corpus", "files", r.file)));
  const opf = book.opf();
  const pages = frontMatter(book, opf);
  const text = pages.map((p) => p.lines.join("\n")).join("\n\n---\n\n");
  let out: { title?: string; author?: string } | null = null;
  const t0 = performance.now();
  try {
    out = await ask(text);
  } catch (e) {
    console.error(`request failed: ${e}`);
  }
  const ms = performance.now() - t0;
  if (!out) model.invalid++;
  const mt = norm(out?.title) === norm(r.title), ma = norm(out?.author) === norm(r.author);
  model.title += +mt; model.author += +ma; model.both += +(mt && ma);
  const rt = norm(guessTitle(book, opf, pages)?.value) === norm(r.title), ra = norm(guessAuthor(pages)?.value) === norm(r.author);
  rules.title += +rt; rules.author += +ra; rules.both += +(rt && ra);
  details.push({ file: r.file, truth: { title: r.title, author: r.author }, model: out, ms: Math.round(ms) });
  process.stdout.write(mt && ma ? "." : "x");
}
const pct = (n: number) => `${((100 * n) / sample.length).toFixed(0)}%`;
const report = `\nModel ${args.model} on ${sample.length} title pages (${args.split}):
  title ${pct(model.title)}, author ${pct(model.author)}, both ${pct(model.both)}, unparseable ${model.invalid}
Rules on the same pages: title ${pct(rules.title)}, author ${pct(rules.author)}, both ${pct(rules.both)}`;
console.log(report);
mkdirSync(join(ROOT, "bench", "results"), { recursive: true });
writeFileSync(join(ROOT, "bench", "results", `model-${args.model.replace(/[^\w.-]/g, "_")}.json`), JSON.stringify({ report, details }, null, 1));
