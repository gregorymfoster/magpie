// PDF: pages of positioned text, not a book. Magpie reads the words back out
// and rebuilds the book: lines grouped by height on the page, the running
// header and page numbers dropped (lines that repeat at the top or bottom of
// most pages), lines joined into paragraphs (by the gap above, an indent, or a
// short line ending a sentence), words broken across lines re-joined, and
// lines in a larger type made headings that start chapters. Pictures and
// tables don't come over. A PDF made of scanned pictures has no words to read.

import { getDocumentProxy } from "unpdf";
import { BookError } from "../epub.ts";
import { pageOf, type Draft, type TocEntry } from "./pack.ts";

interface Line {
  page: number;
  y: number;
  x0: number;
  x1: number;
  size: number;
  text: string;
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A store's lock (Adobe ADEPT and friends) rather than a plain password. */
export function pdfLocked(bytes: Uint8Array): boolean {
  const s = new TextDecoder("latin1").decode(bytes.length > 4_000_000 ? bytes.subarray(0, 2_000_000) : bytes);
  return /\/Encrypt\b/.test(s) && /\/Filter\s*\/(EBX_HANDLER|Adobe\.APS|FOPN_|FileOpen)/.test(s);
}

export async function pdfToDraft(bytes: Uint8Array): Promise<Draft> {
  if (pdfLocked(bytes)) throw new BookError("drm");
  let pdf;
  try {
    pdf = await getDocumentProxy(bytes.slice(), { useSystemFonts: false, disableFontFace: true, isEvalSupported: false } as Parameters<
      typeof getDocumentProxy
    >[1]);
  } catch (e) {
    throw new BookError(/password/i.test(String((e as Error)?.name ?? e)) ? "pdf-password" : "not-a-book");
  }
  try {
    const meta = (await pdf.getMetadata().catch(() => null))?.info as Record<string, unknown> | undefined;
    const pages: Line[][] = [];
    let chars = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items = (content.items as TextItem[]).filter((i) => typeof i.str === "string" && i.str.trim());
      chars += items.reduce((k, i) => k + i.str.length, 0);
      pages.push(lines(items, n));
      page.cleanup();
    }
    if (chars < Math.max(40, pdf.numPages * 20)) throw new BookError("pdf-scanned");
    const draft = rebuild(pages);
    const title = typeof meta?.Title === "string" ? meta.Title.trim() : "";
    const author = typeof meta?.Author === "string" ? meta.Author.trim() : "";
    // Producers often leave a file name or "Microsoft Word - draft.docx" as the title.
    draft.title = title && !/\.(docx?|pdf|indd|tex|odt)$|^untitled$|microsoft word/i.test(title) ? title : "";
    draft.authors = author && !/^(unknown|admin|user)$/i.test(author) ? author.split(/\s*(?:;|&|\band\b)\s*/).filter(Boolean) : [];
    const subject = typeof meta?.Subject === "string" ? meta.Subject.trim() : "";
    if (subject.length > 40) draft.description = subject;
    return draft;
  } finally {
    await pdf.cleanup();
  }
}

/** Text pieces into lines, top to bottom. */
function lines(items: TextItem[], page: number): Line[] {
  const pieces = items
    .map((i) => {
      const size = Math.abs(i.transform[3]) || Math.hypot(i.transform[2], i.transform[3]) || i.height || 10;
      return { x: i.transform[4], y: i.transform[5], w: i.width, size, s: i.str };
    })
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const out: Line[] = [];
  let cur: typeof pieces = [];
  const flush = () => {
    if (!cur.length) return;
    cur.sort((a, b) => a.x - b.x);
    let text = "";
    let end = -Infinity;
    for (const p of cur) {
      if (text && p.x - end > p.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(p.s)) text += " ";
      text += p.s;
      end = p.x + p.w;
    }
    const size = cur.reduce((m, p) => Math.max(m, p.size), 0);
    out.push({ page, y: cur[0].y, x0: cur[0].x, x1: end, size, text: text.replace(/\s+/g, " ").trim() });
    cur = [];
  };
  for (const p of pieces) {
    if (cur.length && Math.abs(cur[0].y - p.y) > Math.min(cur[0].size, p.size) * 0.5) flush();
    cur.push(p);
  }
  flush();
  return out.filter((l) => l.text);
}

const mode = (xs: number[]) => {
  const count = new Map<number, number>();
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
};

function rebuild(pages: Line[][]): Draft {
  // Running heads and page numbers: the top two and bottom two lines of a page, when they repeat across pages.
  const shape = (t: string) => t.replace(/\d+/g, "#").toLowerCase();
  const edge = (p: Line[]) => [...p.slice(0, 2), ...p.slice(-2)];
  const seen = new Map<string, number>();
  for (const p of pages) for (const k of new Set(edge(p).map((l) => shape(l.text)))) seen.set(k, (seen.get(k) ?? 0) + 1);
  const repeats = (t: string) => pages.length >= 4 && (seen.get(shape(t)) ?? 0) >= pages.length * 0.4;
  const pageNumber = /^(page\s*)?(\d{1,4}|[ivxlcdm]{1,7})(\s*(of|\/)\s*\d+)?$/i;
  // Peeled off from the top and the bottom, at most two each way; a body line that happens to repeat is long and stays.
  // A running head also stands apart from the text by more than a line's spacing.
  const apart = (l: Line, next: Line | undefined) => !next || Math.abs(l.y - next.y) > Math.max(l.size, next.size) * 1.9;
  const drop = (l: Line | undefined, next: Line | undefined) => !!l && (pageNumber.test(l.text) || (l.text.length <= 70 && repeats(l.text) && apart(l, next)));
  const body = pages.map((p) => {
    let a = 0;
    let b = p.length;
    while (a < 2 && a < b && drop(p[a], p[a + 1])) a++;
    while (p.length - b < 2 && b > a && drop(p[b - 1], p[b - 2])) b--;
    return p.slice(a, b);
  });

  const all = body.flat();
  const size = mode(all.map((l) => Math.round(l.size * 2) / 2).filter((s) => s > 0));
  const left = mode(all.filter((l) => Math.abs(l.size - size) < 0.6).map((l) => Math.round(l.x0)));
  const right = Math.max(...all.filter((l) => Math.abs(l.size - size) < 0.6).map((l) => l.x1));
  const gaps: number[] = [];
  for (const p of body)
    for (let i = 1; i < p.length; i++) if (Math.abs(p[i].size - size) < 0.6 && Math.abs(p[i - 1].size - size) < 0.6) gaps.push(Math.round(p[i - 1].y - p[i].y));
  const gap = mode(gaps.filter((g) => g > 0)) || size * 1.3;

  type Block = { kind: "h" | "p"; text: string; page: number; level: number };
  const blocks: Block[] = [];
  let prev: Line | null = null;
  for (const p of body) {
    for (const l of p) {
      const heading = l.size >= size * 1.3 && l.text.length < 120;
      const last = blocks[blocks.length - 1];
      if (heading) {
        // A heading set on two lines is one heading.
        if (last?.kind === "h" && prev && prev.page === l.page && prev.y - l.y < l.size * 1.8) last.text += ` ${l.text}`;
        else blocks.push({ kind: "h", text: l.text, page: l.page, level: l.size >= size * 1.7 ? 1 : 2 });
      } else {
        const samePage = prev?.page === l.page;
        const fresh =
          !last ||
          last.kind === "h" ||
          (samePage && prev!.y - l.y > gap * 1.6) ||
          l.x0 > left + size * 0.8 ||
          (prev !== null && prev.x1 < right - size * 3 && /[.!?:"”’)]$/.test(prev.text));
        if (fresh) blocks.push({ kind: "p", text: l.text, page: l.page, level: 0 });
        else if (/[A-Za-z]-$/.test(last.text) && /^[a-z]/.test(l.text)) last.text = last.text.slice(0, -1) + l.text;
        else last.text += ` ${l.text}`;
      }
      prev = l;
    }
  }

  // Chapters start at the largest headings; without any, every 20 pages.
  const top = blocks.some((b) => b.kind === "h" && b.level === 1) ? 1 : 2;
  const chapters: { title: string; parts: string[] }[] = [{ title: "", parts: [] }];
  let lastPage = 1;
  for (const b of blocks) {
    const cur = chapters[chapters.length - 1];
    const startsChapter = b.kind === "h" && b.level <= top;
    const tooLong = !blocks.some((x) => x.kind === "h") && b.page - lastPage >= 20;
    if ((startsChapter || tooLong) && cur.parts.length) chapters.push({ title: "", parts: [] });
    if (tooLong) lastPage = b.page;
    const c = chapters[chapters.length - 1];
    if (b.kind === "h") {
      if (!c.title) c.title = b.text;
      c.parts.push(`<h${b.level === 1 ? 1 : 2}>${esc(b.text)}</h${b.level === 1 ? 1 : 2}>`);
    } else c.parts.push(`<p>${esc(b.text)}</p>`);
  }
  const toc: TocEntry[] = [];
  const name = (i: number) => `text${String(i + 1).padStart(4, "0")}.xhtml`;
  const out = chapters
    .filter((c) => c.parts.length)
    .map((c, i) => {
      // A title page (headings and nothing else) isn't a chapter in the contents.
      if (c.title && c.parts.some((x) => x.startsWith("<p>"))) toc.push({ label: c.title, href: name(i) });
      return { name: name(i), html: pageOf(c.title || "Text", c.parts.join("\n")) };
    });
  return { title: "", authors: [], chapters: out, resources: [], toc };
}
