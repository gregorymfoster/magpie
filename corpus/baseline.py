#!/usr/bin/env python3
"""The oracle: run Calibre's convert-again trick and EPUBCheck over the corpus.

For every file in corpus/manifest.json this writes
  corpus/baseline/calibre/<file>      Calibre's `ebook-convert in.epub out.epub`
  corpus/baseline/original.jsonl      EPUBCheck on the input
  corpus/baseline/calibre.jsonl       EPUBCheck on Calibre's output
  corpus/baseline/calibre-runs.jsonl  Calibre exit code, time, stderr tail
and the same three under calibre-v3 for `ebook-convert --epub-version 3`. The
default (EPUB 2 output) is what forum advice gets you; v3 is the fairer fight.

Ubuntu's Calibre 7.6 package crashes on --epub-version 3 (a bytes/str bug in
calibre/ebooks/oeb/polish/container.py, `r'\1'` should be `rb'\1'`). Patch that
line or use Calibre's own build.

A Calibre crash or timeout is recorded as such, and the scorer counts it as a
failure rather than skipping it.
"""
import json, os, shutil, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FILES = ROOT / "files"
OUT = ROOT / "baseline"
CHECK = ROOT.parent / "tools" / "epubcheck-batch" / "run.sh"


def convert(rel, variant="calibre", extra=()):
    src, dst = FILES / rel, OUT / variant / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    t = time.time()
    try:
        p = subprocess.run(["ebook-convert", str(src), str(dst), *extra], capture_output=True, text=True, timeout=180,
                           env={**os.environ, "QT_QPA_PLATFORM": "offscreen"})
        code, err = p.returncode, p.stderr[-600:]
    except subprocess.TimeoutExpired:
        code, err = "timeout", ""
    ok = code == 0 and dst.exists()
    return {"file": rel, "ok": ok, "exit": code, "seconds": round(time.time() - t, 2), "stderr": "" if ok else err}


def epubcheck(paths, out):
    p = subprocess.run([str(CHECK)], input="\n".join(map(str, paths)), capture_output=True, text=True)
    out.write_text(p.stdout)


def main():
    rows = json.loads((ROOT / "manifest.json").read_text())
    rels = [r["file"] for r in rows]
    OUT.mkdir(exist_ok=True)
    epubcheck([FILES / r for r in rels], OUT / "original.jsonl")
    if not shutil.which("ebook-convert"):
        print("ebook-convert not found: scoring originals only, no Calibre columns", file=sys.stderr)
        return
    for variant, extra in [("calibre", ()), ("calibre-v3", ("--epub-version", "3"))]:
        with ThreadPoolExecutor(os.cpu_count()) as ex:
            runs = list(ex.map(lambda r: convert(r, variant, extra), rels))
        (OUT / f"{variant}-runs.jsonl").write_text("".join(json.dumps(r) + "\n" for r in runs))
        print(f"{variant}: {sum(r['ok'] for r in runs)}/{len(runs)} converted", file=sys.stderr)
        epubcheck([OUT / variant / r["file"] for r in runs if r["ok"]], OUT / f"{variant}.jsonl")


if __name__ == "__main__":
    main()
