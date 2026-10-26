// Every number and date a person reads is formatted here, once.

export const plural = (n: number, word: string, many = word + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? word : many}`;

/** The one ETA: "about 20 s left", from how far a job has got since it started. */
export function eta(done: number, total: number, startedAt: string, now = Date.now()): string {
  if (done === 0) return "starting";
  const per = (now - Date.parse(startedAt)) / done;
  const left = per * (total - done);
  if (left < 1500) return "a moment left";
  if (left < 60_000) return `about ${Math.ceil(left / 1000)} s left`;
  return `about ${Math.ceil(left / 60_000)} min left`;
}

export function size(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

export function date(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

/** A path as a person says it: ~/Books/Magpie. */
export const tilde = (path: string) => path.replace(/^\/(Users|home)\/[^/]+/, "~");

export const authors = (a: string[]) => (a.length ? a.join(" & ") : "Unknown author");

const LANGS: Record<string, string> = {
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
  pt: "Portuguese",
  sv: "Swedish",
  ru: "Russian",
  ja: "Japanese",
  zh: "Chinese",
  la: "Latin",
  nb: "Norwegian",
  da: "Danish",
  fi: "Finnish",
  pl: "Polish",
};
export const language = (code: string) => LANGS[code.toLowerCase().split("-")[0]] ?? (code || "Not set");
