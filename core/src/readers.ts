// The readers a book can be previewed on, and the CSS that lays a chapter out
// the way they do: one screen at a time, in the reader's default face, with
// its margins and spacing. Plain data and strings, no DOM, so the window's
// preview and a headless layout check share one definition.
//
// Screens are in CSS px at 96 to the inch, from each reader's real size, so a
// line holds about as many words as it does in the hand. It's a close look,
// not the reader's own typesetter: Kindle and Kobo have their own engines.

export type ReaderId = "kindle-paperwhite" | "kindle" | "kindle-scribe" | "kobo-clara" | "kobo-libra" | "kobo-sage" | "iphone";

export interface Reader {
  id: ReaderId;
  name: string;
  family: "kindle" | "kobo" | "apple";
  /** Screen size in CSS px. */
  screen: { w: number; h: number };
  /** Black and white e-ink: pictures and coloured text come out grey. */
  eink: boolean;
  /** The face the reader uses when the book's own fonts are off. Fallbacks are what a Mac has. */
  face: string;
  /** Reader default: justified text with hyphenation. */
  justify: boolean;
  /** Frame around the screen, for drawing the device: px on each side and corner radius. */
  bezel: { top: number; right: number; bottom: number; left: number; radius: number };
}

export const READERS: Reader[] = [
  {
    id: "kindle-paperwhite",
    name: "Kindle Paperwhite",
    family: "kindle",
    screen: { w: 392, h: 522 },
    eink: true,
    face: 'Bookerly, Georgia, "Times New Roman", serif',
    justify: true,
    bezel: { top: 30, right: 30, bottom: 56, left: 30, radius: 26 },
  },
  {
    id: "kindle",
    name: "Kindle",
    family: "kindle",
    screen: { w: 343, h: 463 },
    eink: true,
    face: 'Bookerly, Georgia, "Times New Roman", serif',
    justify: true,
    bezel: { top: 30, right: 28, bottom: 56, left: 28, radius: 24 },
  },
  {
    id: "kindle-scribe",
    name: "Kindle Scribe",
    family: "kindle",
    screen: { w: 588, h: 784 },
    eink: true,
    face: 'Bookerly, Georgia, "Times New Roman", serif',
    justify: true,
    bezel: { top: 30, right: 30, bottom: 30, left: 90, radius: 28 },
  },
  {
    id: "kobo-clara",
    name: "Kobo Clara",
    family: "kobo",
    screen: { w: 343, h: 463 },
    eink: true,
    face: 'Georgia, "Times New Roman", serif',
    justify: true,
    bezel: { top: 28, right: 28, bottom: 44, left: 28, radius: 22 },
  },
  {
    id: "kobo-libra",
    name: "Kobo Libra",
    family: "kobo",
    screen: { w: 404, h: 537 },
    eink: true,
    face: 'Georgia, "Times New Roman", serif',
    justify: true,
    bezel: { top: 26, right: 86, bottom: 26, left: 26, radius: 24 },
  },
  {
    id: "kobo-sage",
    name: "Kobo Sage",
    family: "kobo",
    screen: { w: 461, h: 614 },
    eink: true,
    face: 'Georgia, "Times New Roman", serif',
    justify: true,
    bezel: { top: 28, right: 76, bottom: 28, left: 28, radius: 24 },
  },
  {
    id: "iphone",
    name: "iPhone (Apple Books)",
    family: "apple",
    screen: { w: 390, h: 844 },
    eink: false,
    face: '"Iowan Old Style", Palatino, Georgia, serif',
    justify: false,
    bezel: { top: 14, right: 14, bottom: 14, left: 14, radius: 58 },
  },
];

export const reader = (id: string): Reader => READERS.find((r) => r.id === id) ?? READERS[0];

export interface ReaderSettings {
  /** 1 to 7, like the steps of a reader's Aa menu. 3 is the default. */
  size: number;
  margins: "narrow" | "normal" | "wide";
  spacing: "tight" | "normal" | "loose";
  /** The book's own fonts ("Publisher font" on Kindle, "Publisher default" on Kobo). */
  bookFonts: boolean;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = { size: 3, margins: "normal", spacing: "normal", bookFonts: true };

export const FONT_PX = [13, 14.5, 16, 18, 20, 23, 26];
const MARGIN_PX = { narrow: 12, normal: 24, wide: 40 };
const LINE = { tight: 1.25, normal: 1.45, loose: 1.7 };

/** Page margins in px: [top and bottom, left and right]. A phone keeps room for its status bar and home bar. */
export function pageMargins(r: Reader, s: ReaderSettings): [number, number] {
  const side = MARGIN_PX[s.margins];
  return [r.family === "apple" ? 64 : Math.max(18, side * 0.9), side];
}

/**
 * CSS that turns a chapter into pages the size of this reader's screen: one
 * column per screen, laid side by side. Page n is at scrollLeft n × screen
 * width, and the page count is scrollWidth / screen width. Goes last in the
 * document so it wins where a reader overrides the book.
 */
export function readerCss(r: Reader, s: ReaderSettings, colours: { paper: string; ink: string }): string {
  const { w, h } = r.screen;
  const [mv, mh] = pageMargins(r, s);
  const face = s.bookFonts ? "" : `body, body :not(code, pre, kbd, samp, tt) { font-family: ${r.face} !important; }`;
  return `
html { width: ${w}px; height: ${h}px; margin: 0; padding: 0; overflow: hidden; background: ${colours.paper} !important; ${r.eink ? "filter: grayscale(1);" : ""} }
body {
  box-sizing: border-box; width: ${w}px; height: ${h}px; margin: 0 !important; padding: ${mv}px ${mh}px !important;
  column-width: ${w - 2 * mh}px; column-gap: ${2 * mh}px; column-fill: auto;
  max-width: none !important; background: transparent !important; color: ${colours.ink};
  font-family: ${r.face}; font-size: ${FONT_PX[Math.max(1, Math.min(7, s.size)) - 1]}px !important; line-height: ${LINE[s.spacing]};
  overflow-wrap: break-word; -webkit-text-size-adjust: none;
}
body :where(p, li, blockquote, dd) { line-height: ${LINE[s.spacing]} !important; }
${r.justify ? "body :where(p) { text-align: justify; hyphens: auto; -webkit-hyphens: auto; }" : ""}
${face}
img, svg, video, image { max-width: 100% !important; max-height: ${h - 2 * mv}px !important; height: auto; object-fit: contain; break-inside: avoid; }
table, pre { max-width: 100%; }
a[data-link] { color: inherit; text-decoration: underline; }
`;
}
