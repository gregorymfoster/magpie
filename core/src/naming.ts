// Every file and folder name Magpie writes is built here and only here.
// The rule (Greg, 25 Oct): no spaces where possible, readable in Finder.
//   Ursula K. Le Guin, The Dispossessed -> Ursula-K-Le-Guin/The-Dispossessed.epub

const MAX = 80;

/** "Ursula K. Le Guin" -> "Ursula-K-Le-Guin". Accents fold to ASCII; other scripts are kept. */
export function slug(s: string, fallback: string): string {
  const out = s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (!out) return fallback;
  if (out.length <= MAX) return out;
  return out.slice(0, MAX).replace(/-[^-]*$/, "") || out.slice(0, MAX);
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
