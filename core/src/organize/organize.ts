// Sorting a book onto shelves: Fiction or Nonfiction, a genre or two, and a
// vibe. Rules come first and win: what the book's own subjects and Calibre's
// tags already say. The local model only fills what the rules left empty, and
// only when it's clearly sure, so a wrong shelf is rarer than an empty one.
//
// Pure functions over plain text, so the bench and tests can score them
// without a Library.

import { Book, decodeUtf8, textOf } from "../epub.ts";
import { GENRES, KINDS, VIBES, kindOf, type Kind } from "./vocabulary.ts";

/** Bump when the vocabulary, the rules or the thresholds change, so Libraries sort again. */
export const ORGANIZER = 1;

/** Turns texts into unit-length vectors. Supplied by the Host when it has a local model. */
export type Embed = (texts: string[]) => Promise<Float32Array[]>;

export interface Signals {
  title: string;
  description?: string;
  /** dc:subject lines, Calibre tags and a person's own tags: anything that names what the book is. */
  subjects: string[];
  /** The opening pages, for books with no blurb. */
  opening?: string;
}

export interface Guess {
  name: string;
  /** 0 to 1. Rules give 0.95; the model gives less, and nothing under THRESHOLD is kept. */
  confidence: number;
  /** In words, for the inspector: "the book's subjects", "Magpie's model". */
  source: string;
}

/** Model guesses under this are dropped. Rule guesses are always above it. */
export const THRESHOLD = 0.8;

// Similarities from the model are turned into confidences on a straight line between these.
// Tuned on the bench (bench/organize.ts); see its notes for the numbers behind them.
export const TUNING = {
  /** Kind: how far the best fiction genre must beat the best nonfiction genre (or the reverse). */
  kindMargin: [0.0, 0.06] as [number, number],
  /** Genre: how far the best genre must beat the runner-up within its kind. */
  genreMargin: [0.0, 0.05] as [number, number],
  /** Vibe: raw similarity. */
  vibe: [0.5, 0.62] as [number, number],
};

const BY_RULES = "the book's subjects";
const BY_MODEL = "Magpie's model";

/** The subjects a book declares about itself. */
export function readSubjects(book: Book): string[] {
  if (!book.opfPath) return [];
  return book
    .opf()
    .dc("subject")
    .map(textOf)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Roughly the first 2,000 characters of the story itself, skipping front matter where it's easy to tell. */
export function readOpening(book: Book, max = 2000): string {
  if (!book.opfPath) return "";
  const opf = book.opf();
  let out = "";
  for (const ref of opf.itemrefs()) {
    const item = opf.itemById(ref.getAttribute("idref") ?? "");
    if (!item) continue;
    const path = opf.itemPath(item);
    if (!book.has(path)) continue;
    const text = plain(decodeUtf8(book.files.get(path)!));
    // Title pages, copyright pages and contents are short; the story starts with the first long page.
    if (text.length < 600 && !out) continue;
    out += (out ? " " : "") + text;
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

export function plain(html: string): string {
  return html
    .replace(/^[\s\S]*?<body[^>]*>/i, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split "FICTION / Science Fiction / Space Opera" and "Detective and mystery stories -- England" into parts. */
function parts(subjects: string[]): string[] {
  const out: string[] = [];
  for (const s of subjects) {
    const clean = s.replace(/&amp;/g, "&").trim();
    out.push(clean);
    for (const p of clean.split(/\s*(?:\/|--|;|,|\||>)\s*/)) if (p && p !== clean) out.push(p.trim());
  }
  return out.filter((p) => p && !/^(general|non-classifiable|unknown)$/i.test(p));
}

/** What the subjects and tags say, without any model. */
export function byRules(s: Signals): { kind?: Guess; genres: Guess[] } {
  const ps = parts(s.subjects);
  const scores = new Map<string, number>();
  for (const g of GENRES) {
    const n = ps.filter((p) => g.subjects.test(p)).length;
    if (n) scores.set(g.name, n);
  }
  const stories = /:\s*(short )?stories\s*$/i.test(s.title);
  if (stories) scores.set("Short Stories", (scores.get("Short Stories") ?? 0) + 1);

  // Publishers mislabel: Titan, a Rockefeller biography, says "Fiction" next to three business
  // headings. So a Fiction or Nonfiction heading is a strong vote, not the last word.
  const tally = { Fiction: 0, Nonfiction: 0 };
  for (const [name, n] of scores) tally[kindOf(name)!] += n;
  if (ps.some((p) => /^non.?fiction\b/i.test(p))) tally.Nonfiction += 2;
  if (ps.some((p) => /^(fiction|novels?)\b/i.test(p))) tally.Fiction += 2;
  if (stories || /[:(]\s*a novel\b|\bnovel\)?\s*$/i.test(s.title)) tally.Fiction += 3;
  const kind: Kind | undefined = tally.Fiction === tally.Nonfiction ? undefined : tally.Fiction > tally.Nonfiction ? "Fiction" : "Nonfiction";

  const genres = [...scores]
    .filter(([name]) => !kind || kindOf(name) === kind)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => ({ name, confidence: 0.95, source: BY_RULES }));
  // "Literary" alone says little when a sharper genre is there too.
  const sharp = genres.filter((g) => g.name !== "Literary Fiction");
  return { kind: kind && { name: kind, confidence: 0.95, source: BY_RULES }, genres: sharp.length ? sharp : genres };
}

/** The text the model reads: what a person would skim in a bookshop. */
export function blurb(s: Signals): string {
  const desc = s.description ? plain(s.description).slice(0, 1200) : "";
  const body = desc || (s.opening ?? "").slice(0, 1200);
  return [s.title, body, s.subjects.length ? `Subjects: ${s.subjects.slice(0, 8).join(", ")}.` : ""].filter(Boolean).join("\n");
}

const scale = (x: number, [lo, hi]: [number, number]) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Kind, genres and vibes for one book: rules first, then the model for what's left. */
export class Organizer {
  private embed?: Embed;
  private prototypes?: Promise<{ genres: Float32Array[]; vibes: Float32Array[] }>;

  constructor(embed?: Embed) {
    this.embed = embed;
  }

  get hasModel() {
    return !!this.embed;
  }

  async guess(s: Signals): Promise<Guess[]> {
    const rules = byRules(s);
    let kind = rules.kind;
    let genres = rules.genres;
    const vibes: Guess[] = [];
    const text = blurb(s);
    // Without a blurb or an opening there's nothing for the model to read but a title.
    if (this.embed && text.length > s.title.length + 80) {
      const p = await (this.prototypes ??= this.embed([...GENRES.map((g) => g.about), ...VIBES.map((v) => v.about)]).then((v) => ({
        genres: v.slice(0, GENRES.length),
        vibes: v.slice(GENRES.length),
      })));
      const [vec] = await this.embed([text]);
      const sims = GENRES.map((g, i) => ({ g, sim: dot(vec, p.genres[i]) }));
      if (!kind) {
        const best = (k: Kind) => Math.max(...sims.filter((x) => x.g.kind === k).map((x) => x.sim));
        const [f, n] = KINDS.map(best);
        const confidence = 0.5 + 0.5 * scale(Math.abs(f - n), TUNING.kindMargin);
        if (confidence >= THRESHOLD) kind = { name: f > n ? "Fiction" : "Nonfiction", confidence, source: BY_MODEL };
      }
      if (!genres.length && kind) {
        const ranked = sims.filter((x) => x.g.kind === kind!.name).sort((a, b) => b.sim - a.sim);
        const confidence = 0.5 + 0.5 * scale(ranked[0].sim - ranked[1].sim, TUNING.genreMargin);
        if (confidence >= THRESHOLD) genres = [{ name: ranked[0].g.name, confidence, source: BY_MODEL }];
      }
      VIBES.map((v, i) => ({ name: v.name, sim: dot(vec, p.vibes[i]) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 2)
        .forEach(({ name, sim }) => {
          const confidence = 0.5 + 0.5 * scale(sim, TUNING.vibe);
          if (confidence >= THRESHOLD) vibes.push({ name, confidence, source: BY_MODEL });
        });
    }
    if (!kind && genres.length) kind = { name: kindOf(genres[0].name)!, confidence: genres[0].confidence, source: genres[0].source };
    return [...(kind ? [kind] : []), ...genres, ...vibes];
  }
}
