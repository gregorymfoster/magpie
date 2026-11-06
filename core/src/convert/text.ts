// Plain text and single HTML files. Text becomes paragraphs at blank lines
// (or at every line when the file has no blank lines), with lines that look
// like chapter titles ("Chapter 12", "CHAPTER XII", "Part Two") made into
// headings that start a new page. An HTML file is cut into pages at its
// top-level headings.

import { decodeUtf8 } from "../epub.ts";
import { pageOf, type Draft, type TocEntry } from "./pack.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const CHAPTER =
  /^(chapter|part|book|prologue|epilogue|interlude|afterword|foreword|preface|introduction|appendix)\b[\s\w.:'’-]{0,60}$|^[IVXLC]+\.?$|^\d{1,3}\.?$/i;
const name = (i: number) => `text${String(i + 1).padStart(4, "0")}.xhtml`;

export function textToDraft(bytes: Uint8Array): Draft {
  const s = decodeUtf8(bytes).replace(/\r\n?/g, "\n");
  const blocks = /\n[ \t]*\n/.test(s) ? s.split(/\n[ \t]*\n+/) : s.split("\n");
  const paras = blocks.map((b) => b.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  // A Project Gutenberg-style "Title: … / Author: …" header names the book.
  const title = s.match(/^\s*Title:\s*(.+)$/m)?.[1].trim() ?? "";
  const author = s.match(/^\s*Author:\s*(.+)$/m)?.[1].trim();
  const chapters: { title: string; body: string[] }[] = [{ title: "", body: [] }];
  for (const p of paras) {
    if (CHAPTER.test(p) && p.length < 70) chapters.push({ title: p, body: [] });
    else chapters[chapters.length - 1].body.push(`<p>${esc(p)}</p>`);
  }
  const kept = chapters.filter((c) => c.title || c.body.length);
  const toc: TocEntry[] = [];
  const out = kept.map((c, i) => {
    if (c.title) toc.push({ label: c.title, href: name(i) });
    return { name: name(i), html: pageOf(c.title || title || "Text", `${c.title ? `<h2>${esc(c.title)}</h2>` : ""}${c.body.join("\n")}`) };
  });
  return { title, authors: author ? [author] : [], chapters: out, resources: [], toc };
}

export function htmlToDraft(bytes: Uint8Array): Draft {
  const s = decodeUtf8(bytes);
  const title = (s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const author = s.match(/<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i)?.[1];
  const body = s.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? s;
  // Scripts, styles that load things from the web and forms don't belong in a book.
  const clean = body.replace(/<(script|iframe|form|object)\b[\s\S]*?<\/\1>/gi, "").replace(/<(script|iframe|input|object|embed)\b[^>]*\/?>/gi, "");
  const level = /<h1\b/i.test(clean) ? "h1" : "h2";
  const pieces = clean.split(new RegExp(`(?=<${level}\\b)`, "i")).filter((p) => p.replace(/<[^>]+>/g, "").trim());
  const toc: TocEntry[] = [];
  const chapters = pieces.map((p, i) => {
    const heading = p
      .match(new RegExp(`^<${level}\\b[^>]*>([\\s\\S]*?)</${level}>`, "i"))?.[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (heading) toc.push({ label: heading, href: name(i) });
    // Pictures from the web or beside the file aren't brought in.
    return { name: name(i), html: pageOf(heading || title || "Text", p.replace(/<img\b[^>]*>/gi, "")) };
  });
  return { title, authors: author ? [author] : [], chapters, resources: [], toc };
}
