// Every file and folder name Magpie writes is built here and only here.
// The rule (Greg, 25 Oct): no spaces where possible, readable in Finder.
//   Ursula K. Le Guin, The Dispossessed -> Ursula-K-Le-Guin/The-Dispossessed.epub

const MAX = 80;
/**
 * A file name holds 255 bytes of UTF-8 on the Mac (APFS). A device name is an
 * author, a title and an ending together, so each part stays under 120 bytes:
 * 80 letters of English, 40 of Japanese.
 */
const MAX_BYTES = 120;
const utf8 = (ch: string) => new TextEncoder().encode(ch).length;

/** "Ursula K. Le Guin" -> "Ursula-K-Le-Guin". Accents fold to ASCII; other scripts are kept. */
export function slug(s: string, fallback: string): string {
  const out = s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC") // Hangul and the like fold back together once accents are gone
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (!out) return fallback;
  // Cut whole characters (never half of one) at the limit, then back to the last whole word if there is one.
  let cut = "";
  let bytes = 0;
  for (const ch of out) {
    if (cut.length + ch.length > MAX || bytes + utf8(ch) > MAX_BYTES) break;
    cut += ch;
    bytes += utf8(ch);
  }
  if (cut === out) return out;
  return cut.replace(/-[^-]*$/, "") || cut;
}

/** Where a book lives inside books/: Author/Title.epub, relative. */
export function bookPath(authors: string[], title: string, ext = "epub"): string {
  return `${slug(authors[0] ?? "", "Unknown-Author")}/${slug(title, "Untitled")}.${ext}`;
}

/** The file name a device or an email attachment gets: Author-Title.kepub.epub. */
export function deviceName(authors: string[], title: string, ext: string): string {
  return `${slug(authors[0] ?? "", "Unknown-Author")}-${slug(title, "Untitled")}.${ext}`;
}

/** The same path with -2, -3 ... before the extension until `taken` says no. */
export async function unique(path: string, taken: (p: string) => Promise<boolean>): Promise<string> {
  if (!(await taken(path))) return path;
  const m = path.match(/^(.*?)((?:\.kepub)?\.[^./]+)$/) ?? [path, path, ""];
  for (let n = 2; ; n++) {
    const p = `${m[1]}-${n}${m[2]}`;
    if (!(await taken(p))) return p;
  }
}
