# Magpie

Fix the ebook library you already have.

Drop in an EPUB that Kindle rejected, that shows up with a grey cover, or that calls its author "Unknown". Magpie tells you what was wrong in plain English and hands back a fixed copy. It's a desktop app that runs on your machine, so your books never leave it. No account, no upload, no subscription. If you press Look Up, Magpie asks Open Library for missing details (year, publisher, description) by title, author and ISBN, and shows you what it found before anything changes.

Magpie never touches DRM. A store-locked book can sit in your Library with a lock on it, exactly as it came, but Magpie won't fix, convert or send it. It is for books you own as files: Standard Ebooks, Project Gutenberg, Humble Bundle, BookFunnel, Kobo and Amazon's own DRM-free downloads.

> **Status:** early. The core, CLI and window work; the signed Mac app is on its way. Follow along, or help.

## What it fixes today

Six fixers, run in order, each one explaining what it changed:

| Fixer | What goes wrong | What Magpie does |
|---|---|---|
| `container` | The zip wrapper is wrong: no `mimetype`, wrong order, compressed, or `container.xml` missing or pointing nowhere. Most readers give up right here. | Rebuilds the wrapper and finds the real package file. |
| `xhtml` | Pages that aren't valid XHTML: `&nbsp;`, bare `&`, unclosed tags, tag soup, Windows-1252 text, duplicate ids. The classic "we couldn't process your document". | Re-parses each page with a browser-grade HTML parser and writes strict XHTML back out. |
| `manifest` | The file list lies: entries for files that aren't there, files nobody declared, wrong media types, names with spaces, a reading order that skips a chapter. | Reconciles the list with the zip and puts lost chapters back where they were. |
| `cover` | The cover image is in the book but nothing says it's the cover, so Kindle shows a placeholder. | Finds the cover and declares it for both Kindle and EPUB 3 readers. |
| `metadata` | Title is `9780316_final(1)`, author is `Unknown`, no language. | Reads the title and copyright pages and fills them in, noting where each value came from. |
| `toc` | Contents entries that point at missing pages, a mismatched book id, an EPUB 3 file with no contents page. | Drops the dead entries and builds the missing page from what's there. |

Try it:

```sh
npm install
node cli/src/main.ts fix my-book.epub        # writes my-book.fixed.epub and prints what changed
node cli/src/main.ts import ~/Downloads      # brings every EPUB into ~/Books/Magpie
just dev                                     # the window, in a browser, against a real Library
```

Working on Magpie? Read [CLAUDE.md](CLAUDE.md) (it's for people too), then run `just check`.

## How we know it works

Every fixer is scored automatically against a corpus of damaged books, and against the usual forum advice (Calibre's "convert EPUB to EPUB again"). The corpus is built from "damaged twins": clean copies of 60 public-domain books in three house styles (Gutenberg-like EPUB 2, Standard Ebooks-like EPUB 3, indie/Vellum-like EPUB 3), each broken four ways with known defects. Whole books are held out from tuning. A crash, a timeout or a missing output counts as a failure.

Held-out results (48 broken files), from [`bench/results/summary.md`](bench/results/summary.md):

| | Calibre convert-again | Magpie |
|---|---|---|
| Ready for a reader (right cover, title, author, every chapter, no Kindle-critical errors) | 60% | 100% |
| Also passes EPUBCheck with zero errors | 8% | 100% |
| Clean books left clean | 33% | 100% |

Read that with care. The corpus is synthetic and we wrote both the damage and the fixes, so a perfect score mostly proves the bench works. The numbers that matter come next: real broken files from forums, a few hundred Gutenberg and Standard Ebooks downloads, and a log of what Send to Kindle actually accepts.

Calibre's default convert writes EPUB 2 and keeps HTML5 tags like `<section>`, which EPUBCheck rejects. Kindle mostly doesn't care, which is why the "ready" row is the fair comparison.

## Running the bench

You need Node 22.6+, Python 3 with Pillow, Java, and Calibre's `ebook-convert` on your PATH.

```sh
pip install epubcheck pillow     # EPUBCheck 5.x ships inside this package
npm run corpus                   # builds corpus/files (deterministic, seed 1)
npm run baseline                 # Calibre + EPUBCheck over the corpus, a few minutes
npm run bench                    # Magpie + scoring, about 30 seconds
npm test
```

`tools/epubcheck-batch` runs EPUBCheck over many files in one JVM, which takes the bench from twenty minutes to seconds.

To test a small local model at reading title pages (Ollama, LM Studio, or anything OpenAI-compatible):

```sh
ollama pull qwen2.5:1.5b
node --experimental-strip-types bench/model/run.ts --model qwen2.5:1.5b --n 50
```

## Principles

- Nothing changes without showing you the change first, and every filled-in field says where it came from.
- Your books stay on your machine. No server, no telemetry, no inference bill.
- Calibre is used only as a black-box reference in the bench. Magpie contains no Calibre code.
- MIT licensed from the first commit, and it stays that way.

## Roadmap

1. **The oracle** (now): corpus, baseline, first fixers. Next: real-world files and the Send to Kindle log.
2. **The fixer**: a desktop app (Tauri, Mac first). Drop an EPUB, get a diagnosis and a fixed file. KEPUB for Kobo. A small local model for metadata the rules can't read.
3. **Library mode**: point it at a folder or a Calibre library. Duplicates, series, bulk fixes, folder watching.
4. **Heavy jobs**: PDF reflow with a bigger local model, overnight batches.

## License

[MIT](LICENSE).
