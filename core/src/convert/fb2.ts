// FictionBook 2 (.fb2, .fb2.zip): one XML file with the book's details, its
// text as nested <section>s, and its pictures inline as base64. Each top-level
// section becomes a page; titles become headings and the contents.

import { DOMParser } from "@xmldom/xmldom";
import { unzipSync } from "fflate";
import { BookError, decodeUtf8 } from "../epub.ts";
import { imageExt, pageOf, type Draft, type TocEntry } from "./pack.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kids = (el: Element) => [...(el.childNodes as unknown as Node[])].filter((n): n is Element => n.nodeType === 1);
const child = (el: Element | undefined, name: string) => (el ? kids(el).find((k) => k.localName === name) : undefined);
const text = (el: Element | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const href = (el: Element) =>
  (
    el.getAttribute("l:href") ??
    el.getAttribute("xlink:href") ??
    el.getAttribute("href") ??
    [...(el.attributes as unknown as Attr[])].find((a) => a.localName === "href")?.value ??
    ""
  ).replace(/^#/, "");

export function fb2ToDraft(bytes: Uint8Array, zipped = false): Draft {
  if (zipped) {
    const inner = Object.entries(unzipSync(bytes)).find(([n]) => /\.fb2$/i.test(n));
    if (!inner) throw new BookError("not-a-book");
    bytes = inner[1];
  }
  const src = decodeUtf8(bytes);
  // The XML declaration can name an encoding the bytes don't use any more once decoded.
  const doc = new DOMParser({ onError: () => {} }).parseFromString(src.replace(/^\s*<\?xml[^>]*\?>/, ""), "text/xml") as unknown as Document;
  const root = doc.documentElement;
  if (!root || root.localName !== "FictionBook") throw new BookError("not-a-book");

  const images = new Map<string, string>();
  const resources: Draft["resources"] = [];
  for (const b of kids(root).filter((k) => k.localName === "binary")) {
    try {
      const bin = Uint8Array.from(atob(text(b).replace(/\s+/g, "")), (c) => c.charCodeAt(0));
      const ext = imageExt(bin);
      if (!ext) continue;
      const path = `images/image${String(resources.length + 1).padStart(4, "0")}.${ext}`;
      resources.push({ path, bytes: bin });
      images.set(b.getAttribute("id") ?? "", path);
    } catch {
      /* a picture that won't decode is left out */
    }
  }

  const info = child(child(root, "description"), "title-info");
  const publish = child(child(root, "description"), "publish-info");
  const authors = kids(info ?? root)
    .filter((k) => k.localName === "author")
    .map(
      (a) => [text(child(a, "first-name")), text(child(a, "middle-name")), text(child(a, "last-name"))].filter(Boolean).join(" ") || text(child(a, "nickname")),
    )
    .filter(Boolean);
  const coverRef = child(child(info, "coverpage"), "image");

  const inline = (el: Element): string =>
    [...(el.childNodes as unknown as Node[])]
      .map((n) => {
        if (n.nodeType === 3) return esc(n.nodeValue ?? "");
        if (n.nodeType !== 1) return "";
        const e = n as Element;
        const inner = inline(e);
        switch (e.localName) {
          case "strong":
            return `<strong>${inner}</strong>`;
          case "emphasis":
            return `<em>${inner}</em>`;
          case "strikethrough":
            return `<s>${inner}</s>`;
          case "sub":
          case "sup":
          case "code":
            return `<${e.localName}>${inner}</${e.localName}>`;
          case "a":
            return inner;
          case "image": {
            const p = images.get(href(e));
            return p ? `<img src="${p}" alt=""/>` : "";
          }
          default:
            return inner;
        }
      })
      .join("");

  const block = (el: Element, depth: number): string =>
    kids(el)
      .map((k) => {
        switch (k.localName) {
          case "title":
            return `<h${Math.min(depth + 1, 6)}>${kids(k)
              .map((p) => inline(p))
              .join("<br/>")}</h${Math.min(depth + 1, 6)}>`;
          case "p":
            return `<p>${inline(k)}</p>`;
          case "subtitle":
            return `<p class="subtitle"><strong>${inline(k)}</strong></p>`;
          case "empty-line":
            return '<p class="empty-line"> </p>';
          case "epigraph":
          case "cite":
            return `<blockquote>${block(k, depth)}</blockquote>`;
          case "poem":
          case "stanza":
            return `<div class="${k.localName}">${block(k, depth)}</div>`;
          case "v":
            return `<p class="verse">${inline(k)}</p>`;
          case "text-author":
            return `<p class="text-author">${inline(k)}</p>`;
          case "image": {
            const p = images.get(href(k));
            return p ? `<div class="image"><img src="${p}" alt=""/></div>` : "";
          }
          case "section":
            return block(k, depth + 1);
          case "table":
            return `<table>${kids(k)
              .map(
                (tr) =>
                  `<tr>${kids(tr)
                    .map((td) => `<${td.localName === "th" ? "th" : "td"}>${inline(td)}</${td.localName === "th" ? "th" : "td"}>`)
                    .join("")}</tr>`,
              )
              .join("")}</table>`;
          default:
            return "";
        }
      })
      .join("\n");

  const bodies = kids(root).filter((k) => k.localName === "body");
  const main = bodies.find((b) => !b.getAttribute("name")) ?? bodies[0];
  if (!main) throw new BookError("no-text");
  const chapters: Draft["chapters"] = [];
  const toc: TocEntry[] = [];
  const title = text(child(info, "book-title"));
  const lead = kids(main).filter((k) => k.localName !== "section");
  if (lead.some((k) => k.localName !== "title" || kids(main).every((s) => s.localName !== "section"))) {
    const wrap = main.ownerDocument!.createElement("div");
    lead.forEach((k) => wrap.appendChild(k.cloneNode(true)));
    chapters.push({ name: "text0000.xhtml", html: pageOf(title, block(wrap, 0)) });
  }
  for (const s of kids(main).filter((k) => k.localName === "section")) {
    const name = `text${String(chapters.length + 1).padStart(4, "0")}.xhtml`;
    let label = text(child(s, "title"));
    // Untitled sections that open with a short bold line ("Chapter One") use that line as their title.
    const opener = kids(s)[0];
    if (
      !label &&
      opener?.localName === "p" &&
      kids(opener).length === 1 &&
      kids(opener)[0].localName === "strong" &&
      text(opener).length < 70 &&
      text(opener) === text(kids(opener)[0])
    ) {
      label = text(opener);
      const t = s.ownerDocument!.createElement("title");
      const p = s.ownerDocument!.createElement("p");
      p.appendChild(s.ownerDocument!.createTextNode(label));
      t.appendChild(p);
      s.replaceChild(t, opener);
    }
    const subs = kids(s)
      .filter((k) => k.localName === "section" && text(child(k, "title")))
      .map((k, i) => ({ label: text(child(k, "title")), href: `${name}#s${i + 1}` }));
    let html = block(s, 1);
    let n = 0;
    // Subsection headings get ids so the contents can point at them.
    if (subs.length) html = html.replace(/<h3>/g, () => `<h3 id="s${++n}">`);
    chapters.push({ name, html: pageOf(label || title, html) });
    if (label) toc.push({ label, href: name, children: subs.length === n ? subs : [] });
  }
  // Footnotes live in a second body; they become a last page.
  const notes = bodies.find((b) => b !== main);
  if (notes) chapters.push({ name: "notes.xhtml", html: pageOf("Notes", block(notes, 1)) });

  return {
    title,
    authors,
    language: text(child(info, "lang")) || undefined,
    description: text(child(info, "annotation")) || undefined,
    publisher: text(child(publish, "publisher")) || undefined,
    date: text(child(publish, "year")) || text(child(info, "date")) || undefined,
    isbn: text(child(publish, "isbn")).replace(/[^0-9Xx]/g, "") || undefined,
    subjects: kids(info ?? root)
      .filter((k) => k.localName === "genre")
      .map(text),
    chapters,
    resources,
    cover: coverRef ? images.get(href(coverRef)) : undefined,
    toc,
  };
}
