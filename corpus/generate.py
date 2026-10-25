#!/usr/bin/env python3
"""Build Magpie's synthetic test corpus.

Makes clean EPUBs for a list of real public-domain books in three house styles
(Gutenberg-like EPUB2, Standard Ebooks-like EPUB3, indie/Vellum-like EPUB3),
then derives broken copies by injecting known defects. Every file gets a row in
corpus/manifest.json with its ground-truth metadata and the defects injected,
so fixers can be scored automatically.

The body text is filler. What matters for the fixers and the metadata test is
the package structure, the title page and the copyright page.

Usage: python3 corpus/generate.py [--seed N] [--out corpus/files]
"""
import argparse, io, json, random, re, shutil, uuid, zipfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BOOKS = [
    # title, author, year, lang, series, series_index
    ("Pride and Prejudice", "Jane Austen", 1813, "en", None, None),
    ("Emma", "Jane Austen", 1815, "en", None, None),
    ("Persuasion", "Jane Austen", 1817, "en", None, None),
    ("Moby-Dick", "Herman Melville", 1851, "en", None, None),
    ("Frankenstein", "Mary Wollstonecraft Shelley", 1818, "en", None, None),
    ("Dracula", "Bram Stoker", 1897, "en", None, None),
    ("A Study in Scarlet", "Arthur Conan Doyle", 1887, "en", "Sherlock Holmes", 1),
    ("The Sign of the Four", "Arthur Conan Doyle", 1890, "en", "Sherlock Holmes", 2),
    ("The Adventures of Sherlock Holmes", "Arthur Conan Doyle", 1892, "en", "Sherlock Holmes", 3),
    ("The Hound of the Baskervilles", "Arthur Conan Doyle", 1902, "en", "Sherlock Holmes", 5),
    ("A Princess of Mars", "Edgar Rice Burroughs", 1912, "en", "Barsoom", 1),
    ("The Gods of Mars", "Edgar Rice Burroughs", 1913, "en", "Barsoom", 2),
    ("The Warlord of Mars", "Edgar Rice Burroughs", 1914, "en", "Barsoom", 3),
    ("The Wonderful Wizard of Oz", "L. Frank Baum", 1900, "en", "Oz", 1),
    ("The Marvelous Land of Oz", "L. Frank Baum", 1904, "en", "Oz", 2),
    ("Ozma of Oz", "L. Frank Baum", 1907, "en", "Oz", 3),
    ("Anne of Green Gables", "L. M. Montgomery", 1908, "en", "Anne of Green Gables", 1),
    ("Anne of Avonlea", "L. M. Montgomery", 1909, "en", "Anne of Green Gables", 2),
    ("Tarzan of the Apes", "Edgar Rice Burroughs", 1912, "en", "Tarzan", 1),
    ("The Return of Tarzan", "Edgar Rice Burroughs", 1913, "en", "Tarzan", 2),
    ("Great Expectations", "Charles Dickens", 1861, "en", None, None),
    ("A Tale of Two Cities", "Charles Dickens", 1859, "en", None, None),
    ("Bleak House", "Charles Dickens", 1853, "en", None, None),
    ("Middlemarch", "George Eliot", 1872, "en", None, None),
    ("Jane Eyre", "Charlotte Brontë", 1847, "en", None, None),
    ("Wuthering Heights", "Emily Brontë", 1847, "en", None, None),
    ("The Picture of Dorian Gray", "Oscar Wilde", 1890, "en", None, None),
    ("The Time Machine", "H. G. Wells", 1895, "en", None, None),
    ("The War of the Worlds", "H. G. Wells", 1898, "en", None, None),
    ("The Invisible Man", "H. G. Wells", 1897, "en", None, None),
    ("Heart of Darkness", "Joseph Conrad", 1899, "en", None, None),
    ("The Call of the Wild", "Jack London", 1903, "en", None, None),
    ("White Fang", "Jack London", 1906, "en", None, None),
    ("The Age of Innocence", "Edith Wharton", 1920, "en", None, None),
    ("The Scarlet Letter", "Nathaniel Hawthorne", 1850, "en", None, None),
    ("Little Women", "Louisa May Alcott", 1868, "en", "Little Women", 1),
    ("Good Wives", "Louisa May Alcott", 1869, "en", "Little Women", 2),
    ("Treasure Island", "Robert Louis Stevenson", 1883, "en", None, None),
    ("Kidnapped", "Robert Louis Stevenson", 1886, "en", None, None),
    ("The Thirty-Nine Steps", "John Buchan", 1915, "en", "Richard Hannay", 1),
    ("Greenmantle", "John Buchan", 1916, "en", "Richard Hannay", 2),
    ("The Secret Adversary", "Agatha Christie", 1922, "en", "Tommy and Tuppence", 1),
    ("The Mysterious Affair at Styles", "Agatha Christie", 1920, "en", "Hercule Poirot", 1),
    ("The Murder on the Links", "Agatha Christie", 1923, "en", "Hercule Poirot", 2),
    ("The Great Gatsby", "F. Scott Fitzgerald", 1925, "en", None, None),
    ("This Side of Paradise", "F. Scott Fitzgerald", 1920, "en", None, None),
    ("Siddhartha", "Hermann Hesse", 1922, "de", None, None),
    ("Die Verwandlung", "Franz Kafka", 1915, "de", None, None),
    ("Der Prozess", "Franz Kafka", 1925, "de", None, None),
    ("Madame Bovary", "Gustave Flaubert", 1857, "fr", None, None),
    ("Les Misérables", "Victor Hugo", 1862, "fr", None, None),
    ("Le Comte de Monte-Cristo", "Alexandre Dumas", 1844, "fr", None, None),
    ("Les Trois Mousquetaires", "Alexandre Dumas", 1844, "fr", "d'Artagnan Romances", 1),
    ("Vingt ans après", "Alexandre Dumas", 1845, "fr", "d'Artagnan Romances", 2),
    ("Don Quijote de la Mancha", "Miguel de Cervantes Saavedra", 1605, "es", None, None),
    ("La Regenta", "Leopoldo Alas", 1884, "es", None, None),
    ("I promessi sposi", "Alessandro Manzoni", 1827, "it", None, None),
    ("Max Havelaar", "Multatuli", 1860, "nl", None, None),
    ("Pan", "Knut Hamsun", 1894, "nb", None, None),
    ("Dead Souls", "Nikolai Gogol", 1842, "en", None, None),
]

WORDS = ("the of and a to in he was that it his her with as had for she on at by not "
         "but be which from have they all were this one so been said would when there "
         "upon could no more their what out very into time some man than only then little "
         "now about know before over great after well must own before house night morning "
         "letter door window road garden river evening silence moment voice hand eyes face "
         "heart mind world thought looked answered turned walked remembered wondered "
         "quiet strange gentle cold bright dark long old young certain whole small").split()

STYLES = ["gutenberg", "standard", "indie"]


def prose(rng, n_par=6):
    out = []
    for _ in range(n_par):
        sents = []
        for _ in range(rng.randint(3, 7)):
            w = [rng.choice(WORDS) for _ in range(rng.randint(6, 18))]
            s = " ".join(w)
            sents.append(s[0].upper() + s[1:] + rng.choice([".", ".", ".", "?", "!", ";"]).replace(";", "."))
        out.append(" ".join(sents))
    return out


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def cover_jpeg(title, author, rng, size=(1600, 2560)):
    hue = rng.randint(0, 255)
    img = Image.new("RGB", size, (hue // 2 + 40, 60, 255 - hue // 2))
    d = ImageDraw.Draw(img)
    try:
        f1 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", 120)
        f2 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", 80)
    except OSError:
        f1 = f2 = ImageFont.load_default()
    y = 500
    for line in wrap(title, 18):
        d.text((120, y), line, font=f1, fill="white"); y += 150
    d.text((120, size[1] - 400), author, font=f2, fill="white")
    buf = io.BytesIO(); img.save(buf, "JPEG", quality=70)
    return buf.getvalue()


def wrap(s, n):
    lines, cur = [], ""
    for w in s.split():
        if len(cur) + len(w) + 1 > n and cur:
            lines.append(cur); cur = w
        else:
            cur = (cur + " " + w).strip()
    return lines + [cur]


def xhtml(title, body, lang, epub3, css="../css/style.css"):
    ns = ' xmlns:epub="http://www.idpf.org/2007/ops"' if epub3 else ""
    doctype = "<!DOCTYPE html>" if epub3 else ('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" '
                                              '"http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">')
    langattr = f' xml:lang="{lang}"' + (f' lang="{lang}"' if epub3 else "")
    return (f'<?xml version="1.0" encoding="utf-8"?>\n{doctype}\n'
            f'<html xmlns="http://www.w3.org/1999/xhtml"{ns}{langattr}>\n<head>\n<title>{esc(title)}</title>\n'
            f'<link rel="stylesheet" type="text/css" href="{css}"/>\n</head>\n<body>\n{body}\n</body>\n</html>\n')


def title_page(b, style, rng):
    t, a, year, lang, series, idx = b
    if style == "gutenberg":
        return (f'<div class="titlepage"><p>The Project Gutenberg eBook of {esc(t)}</p>'
                f'<p>This ebook is for the use of anyone anywhere in the United States and most other parts '
                f'of the world at no cost and with almost no restrictions whatsoever.</p>'
                f'<p>Title: {esc(t)}</p><p>Author: {esc(a)}</p>'
                f'<p>Release date: {rng.choice(["January", "March", "June", "October"])} {rng.randint(1,28)}, '
                f'{rng.randint(1994, 2022)} [eBook #{rng.randint(100, 70000)}]</p><p>Language: {lang}</p>'
                f'<p>*** START OF THE PROJECT GUTENBERG EBOOK {esc(t.upper())} ***</p></div>')
    if style == "standard":
        return (f'<section id="titlepage" epub:type="titlepage"><h1 epub:type="title">{esc(t)}</h1>'
                f'<p>By <b>{esc(a)}</b>.</p></section>')
    ser = f'<p class="series">Book {idx} of {esc(series)}</p>' if series else ""
    return (f'<div class="title"><h1>{esc(t.upper())}</h1>{ser}<p class="author">{esc(a.upper())}</p>'
            f'<p class="publisher">{rng.choice(["Hollow Pine Press", "Fernhill Books", "Lantern House"])}</p></div>')


def copyright_page(b, style, rng, isbn):
    t, a, year, lang, series, idx = b
    if style == "standard":
        return (f'<section id="imprint" epub:type="imprint"><h2>Imprint</h2><p>This ebook is the product of '
                f'many hours of hard work by volunteers for Standard Ebooks. It is based on a transcription '
                f'produced in {rng.randint(1995, 2015)} and on digital scans of the {year} edition.</p></section>')
    if style == "gutenberg":
        return (f'<div><p>{esc(t)}, by {esc(a)}. First published {year}.</p><p>Updated editions will replace '
                f'the previous one; the old editions will be renamed.</p></div>')
    ser = f'<p>{esc(series)}, Book {idx}</p>' if series else ""
    return (f'<div class="copyright"><p>{esc(t)}</p>{ser}<p>Copyright © {rng.randint(2015, 2025)} by {esc(a)} '
            f'(text originally published {year})</p><p>All rights reserved.</p><p>ISBN: {isbn}</p>'
            f'<p>Cover design by {rng.choice(["Studio Kite", "M. Ortega", "Paper Owl Design"])}</p></div>')


def isbn13(rng):
    d = [9, 7, 8] + [rng.randint(0, 9) for _ in range(9)]
    s = sum(x * (1 if i % 2 == 0 else 3) for i, x in enumerate(d))
    return "".join(map(str, d + [(10 - s % 10) % 10]))


def build_book(b, style, rng, font=False):
    """Return (files: dict[path->bytes], meta)."""
    t, a, year, lang, series, idx = b
    epub3 = style != "gutenberg"
    isbn = isbn13(rng) if style == "indie" else None
    uid = f"urn:uuid:{uuid.UUID(int=rng.getrandbits(128))}"
    n_ch = rng.randint(3, 8)
    files = {"mimetype": b"application/epub+zip",
             "META-INF/container.xml": (
                 b'<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" '
                 b'xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles>\n'
                 b'<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n'
                 b'</rootfiles>\n</container>\n')}
    css = "body { font-family: serif; margin: 0 5%; }\nh1, h2 { text-align: center; }\np { text-indent: 1em; margin: 0; }\n"
    items = [("css", "css/style.css", "text/css", None)]
    if font:
        css = "@font-face { font-family: 'Body'; src: url(../fonts/body.ttf); }\n" + css.replace("serif", "'Body', serif")
        files["OEBPS/fonts/body.ttf"] = Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf").read_bytes()
        items.append(("font", "fonts/body.ttf", "application/vnd.ms-opentype" if not epub3 else "font/ttf", None))
    files["OEBPS/css/style.css"] = css.encode()
    files["OEBPS/images/cover.jpg"] = cover_jpeg(t, a, rng)
    items.append(("cover-img", "images/cover.jpg", "image/jpeg", "cover-image" if epub3 else None))
    spine = []
    files["OEBPS/text/cover.xhtml"] = xhtml("Cover", '<div class="cover"><img src="../images/cover.jpg" alt="Cover"/></div>', lang, epub3).encode()
    items.append(("cover", "text/cover.xhtml", "application/xhtml+xml", None)); spine.append("cover")
    files["OEBPS/text/titlepage.xhtml"] = xhtml(t, title_page(b, style, rng), lang, epub3).encode()
    items.append(("titlepage", "text/titlepage.xhtml", "application/xhtml+xml", None)); spine.append("titlepage")
    files["OEBPS/text/copyright.xhtml"] = xhtml("Copyright", copyright_page(b, style, rng, isbn), lang, epub3).encode()
    items.append(("copyright", "text/copyright.xhtml", "application/xhtml+xml", None)); spine.append("copyright")
    toc = []
    for i in range(1, n_ch + 1):
        heading = f"Chapter {i}" if lang == "en" else f"{i}"
        pars = "\n".join(f"<p>{p}</p>" for p in prose(rng, rng.randint(4, 9)))
        body = f'<section id="ch{i}"><h2>{heading}</h2>\n{pars}</section>' if epub3 else f'<div id="ch{i}"><h2>{heading}</h2>\n{pars}</div>'
        href = f"text/chapter{i:02d}.xhtml"
        files["OEBPS/" + href] = xhtml(heading, body, lang, epub3).encode()
        items.append((f"ch{i:02d}", href, "application/xhtml+xml", None)); spine.append(f"ch{i:02d}")
        toc.append((heading, href))
    # NCX for everyone (EPUB3 keeps it for old readers, as most real files do)
    nav_points = "\n".join(
        f'<navPoint id="np{i}" playOrder="{i}"><navLabel><text>{esc(h)}</text></navLabel><content src="{href}"/></navPoint>'
        for i, (h, href) in enumerate(toc, 1))
    files["OEBPS/toc.ncx"] = (
        f'<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n'
        f'<head><meta name="dtb:uid" content="{uid}"/><meta name="dtb:depth" content="1"/>'
        f'<meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>\n'
        f'<docTitle><text>{esc(t)}</text></docTitle>\n<navMap>\n{nav_points}\n</navMap>\n</ncx>\n').encode()
    items.append(("ncx", "toc.ncx", "application/x-dtbncx+xml", None))
    if epub3:
        lis = "".join(f'<li><a href="{href}">{esc(h)}</a></li>' for h, href in toc)
        files["OEBPS/nav.xhtml"] = xhtml("Contents", f'<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>{lis}</ol></nav>',
                                        lang, True, css="css/style.css").encode()
        items.append(("nav", "nav.xhtml", "application/xhtml+xml", "nav"))
    # OPF
    md = [f'<dc:identifier id="bookid">{uid}</dc:identifier>', f"<dc:title>{esc(t)}</dc:title>",
          f"<dc:language>{lang}</dc:language>"]
    if epub3:
        md.append(f'<dc:creator id="author">{esc(a)}</dc:creator>')
        md.append('<meta property="dcterms:modified">2024-05-01T00:00:00Z</meta>')
        if series:
            md.append(f'<meta property="belongs-to-collection" id="c1">{esc(series)}</meta>'
                      f'<meta refines="#c1" property="collection-type">series</meta>'
                      f'<meta refines="#c1" property="group-position">{idx}</meta>')
    else:
        sort = a.split()[-1] + ", " + " ".join(a.split()[:-1])
        md.append(f'<dc:creator opf:role="aut" opf:file-as="{esc(sort)}">{esc(a)}</dc:creator>')
        md.append('<meta name="cover" content="cover-img"/>')
        md.append(f"<dc:date>{year}</dc:date>")
    if isbn:
        md.append(f'<dc:identifier id="isbn">urn:isbn:{isbn}</dc:identifier>' if epub3 else
                  f'<dc:identifier opf:scheme="ISBN">{isbn}</dc:identifier>')
    if series:
        md.append(f'<meta name="calibre:series" content="{esc(series)}"/><meta name="calibre:series_index" content="{idx}"/>')
    if epub3 and style == "standard":
        md.append('<meta name="cover" content="cover-img"/>')  # SE ships the EPUB2 fallback too
    man = "\n".join(
        f'<item id="{i}" href="{h}" media-type="{mt}"' + (f' properties="{p}"' if p else "") + "/>"
        for i, h, mt, p in items)
    spine_xml = "\n".join(f'<itemref idref="{s}"/>' for s in spine)
    ver = "3.0" if epub3 else "2.0"
    files["OEBPS/content.opf"] = (
        f'<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="{ver}" '
        f'unique-identifier="bookid">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" '
        f'xmlns:opf="http://www.idpf.org/2007/opf">\n' + "\n".join(md) +
        f'\n</metadata>\n<manifest>\n{man}\n</manifest>\n<spine toc="ncx">\n{spine_xml}\n</spine>\n'
        + ('<guide><reference type="cover" title="Cover" href="text/cover.xhtml"/></guide>\n' if not epub3 else "")
        + "</package>\n").encode()
    meta = {"title": t, "author": a, "language": lang, "series": series, "series_index": idx,
            "isbn": isbn, "year": year, "style": style, "epub_version": ver}
    return files, meta


# ---------------------------------------------------------------- defects
# Each takes (files, rng) and mutates files in place. The zip-level ones return
# flags for write_epub. Categories line up with the fixers we plan to write.

def opf(files):
    return files["OEBPS/content.opf"].decode()


def set_opf(files, s):
    files["OEBPS/content.opf"] = s.encode()


def d_mimetype_missing(f, r): del f["mimetype"]; return {}
def d_mimetype_not_first(f, r): return {"mimetype_last": True}
def d_mimetype_compressed(f, r): return {"mimetype_deflate": True}
def d_mimetype_wrong(f, r): f["mimetype"] = b"application/epub+zip\n"; return {}


def d_container_missing(f, r): del f["META-INF/container.xml"]; return {}


def d_container_wrong_path(f, r):
    f["META-INF/container.xml"] = f["META-INF/container.xml"].replace(b"OEBPS/content.opf", b"content.opf"); return {}


def d_cover_undeclared(f, r):
    s = opf(f)
    s = re.sub(r'<meta name="cover"[^>]*/>', "", s).replace(' properties="cover-image"', "")
    set_opf(f, s); return {}


def d_cover_wrong_id(f, r):
    s = opf(f)
    if '<meta name="cover"' not in s:
        s = s.replace("</metadata>", '<meta name="cover" content="cover-img"/></metadata>')
    s = re.sub(r'<meta name="cover" content="[^"]*"', '<meta name="cover" content="images/cover.jpg"', s)
    s = s.replace(' properties="cover-image"', "")
    set_opf(f, s); return {}


def chapter(f, r):
    return r.choice(sorted(k for k in f if "chapter" in k))


def d_xhtml_unclosed(f, r):
    k = chapter(f, r)
    s = f[k].decode().replace("<p>", "<p><b>", 1).replace("</p>", "</p><br>", 1)
    f[k] = s.encode(); return {}


def d_xhtml_entities(f, r):
    k = chapter(f, r)
    s = f[k].decode().replace("</p>", " Tom &amp; Jerry&nbsp;&mdash; Smith & Sons</p>", 1).replace("&amp;", "&", 1)
    f[k] = s.encode(); return {}


def d_xhtml_html_not_xml(f, r):
    # Saved as tag-soup HTML: no XML decl, uppercase tags, unquoted attributes
    k = chapter(f, r)
    s = f[k].decode()
    s = re.sub(r"<\?xml[^>]*\?>\n", "", s)
    s = s.replace('<section id="', "<DIV id=").replace('<div id="', "<DIV id=").replace('"><h2>', "><H2>", 1)
    s = s.replace("</section>", "</DIV>").replace("</div>", "</DIV>").replace("</h2>", "</H2>", 1)
    s = s.replace('<link rel="stylesheet" type="text/css" href="../css/style.css"/>',
                  '<link rel=stylesheet type=text/css href=../css/style.css>')
    f[k] = s.encode(); return {}


def d_encoding_cp1252(f, r):
    k = chapter(f, r)
    s = f[k].decode().replace("</p>", " “Quoted,” she said — café.</p>", 2)
    f[k] = s.encode("cp1252"); return {}


def d_manifest_missing_file(f, r):
    k = chapter(f, r); del f[k]; return {}


def d_manifest_unlisted_file(f, r):
    # an image referenced from a chapter but missing from the manifest
    k = chapter(f, r)
    f["OEBPS/images/map.png"] = _png()
    f[k] = f[k].replace(b"</h2>", b'</h2>\n<div><img src="../images/map.png" alt="Map"/></div>', 1); return {}


def _png():
    buf = io.BytesIO(); Image.new("RGB", (400, 300), (200, 180, 140)).save(buf, "PNG"); return buf.getvalue()


def d_spine_bad_idref(f, r):
    set_opf(f, opf(f).replace('<itemref idref="ch02"/>', '<itemref idref="chapter-2"/>')); return {}


def d_media_type_wrong(f, r):
    s = opf(f).replace('href="text/chapter01.xhtml" media-type="application/xhtml+xml"',
                       'href="text/chapter01.xhtml" media-type="text/html"')
    s = s.replace('media-type="image/jpeg"', 'media-type="image/jpg"')
    set_opf(f, s); return {}


def d_href_spaces(f, r):
    old = "text/chapter01.xhtml"; new = "text/Chapter 1.xhtml"
    f["OEBPS/" + new] = f.pop("OEBPS/" + old)
    for k in list(f):
        if k.endswith((".opf", ".ncx", ".xhtml")):
            f[k] = f[k].replace(old.encode(), new.encode())
    return {}


def d_meta_no_language(f, r):
    set_opf(f, re.sub(r"<dc:language>[^<]*</dc:language>", "", opf(f))); return {}


def d_meta_unknown_author(f, r):
    set_opf(f, re.sub(r"(<dc:creator[^>]*>)[^<]*(</dc:creator>)", r"\1Unknown\2", opf(f))); return {}


def d_meta_no_author(f, r):
    set_opf(f, re.sub(r"<dc:creator[^>]*>[^<]*</dc:creator>", "", opf(f))); return {}


def d_meta_filename_title(f, r):
    junk = r.choice(["9780316_final(1)", "book_v2_FINAL", "Untitled", "ebook-export-2019-03-11", "manuscript"])
    set_opf(f, re.sub(r"<dc:title>[^<]*</dc:title>", f"<dc:title>{junk}</dc:title>", opf(f))); return {}


def d_meta_no_title(f, r):
    set_opf(f, re.sub(r"<dc:title>[^<]*</dc:title>", "", opf(f))); return {}


def d_meta_uid_mismatch(f, r):
    set_opf(f, opf(f).replace('unique-identifier="bookid"', 'unique-identifier="BookId"')); return {}


def d_meta_no_modified(f, r):
    set_opf(f, re.sub(r'<meta property="dcterms:modified">[^<]*</meta>', "", opf(f))); return {}


def d_toc_ncx_broken(f, r):
    f["OEBPS/toc.ncx"] = f["OEBPS/toc.ncx"].replace(b"text/chapter02.xhtml", b"text/ch2.xhtml"); return {}


def d_toc_nav_missing(f, r):
    if "OEBPS/nav.xhtml" in f:
        del f["OEBPS/nav.xhtml"]
        set_opf(f, re.sub(r'<item id="nav"[^>]*/>\n?', "", opf(f)))
    return {}


def d_font_corrupt(f, r):
    f["OEBPS/fonts/extra.otf"] = bytes(r.getrandbits(8) for _ in range(4000))
    set_opf(f, opf(f).replace("</manifest>", '<item id="extra-font" href="fonts/extra.otf" media-type="font/otf"/>\n</manifest>'))
    f["OEBPS/css/style.css"] = b"@font-face { font-family: 'X'; src: url(../fonts/extra.otf); }\n" + f["OEBPS/css/style.css"]
    return {}


def d_duplicate_ids(f, r):
    k = chapter(f, r)
    f[k] = f[k].replace(b"<p>", b'<p id="p1">', 2); return {}


DEFECTS = {
    # name: (category, fn, applies_to_epub2?)
    "mimetype_missing": ("container", d_mimetype_missing, True),
    "mimetype_not_first": ("container", d_mimetype_not_first, True),
    "mimetype_compressed": ("container", d_mimetype_compressed, True),
    "mimetype_trailing_newline": ("container", d_mimetype_wrong, True),
    "container_missing": ("container", d_container_missing, True),
    "container_wrong_path": ("container", d_container_wrong_path, True),
    "cover_undeclared": ("cover", d_cover_undeclared, True),
    "cover_wrong_id": ("cover", d_cover_wrong_id, True),
    "xhtml_unclosed_tags": ("xhtml", d_xhtml_unclosed, True),
    "xhtml_html_entities": ("xhtml", d_xhtml_entities, True),
    "xhtml_tag_soup": ("xhtml", d_xhtml_html_not_xml, True),
    "encoding_cp1252": ("xhtml", d_encoding_cp1252, True),
    "manifest_missing_file": ("manifest", d_manifest_missing_file, True),
    "manifest_unlisted_file": ("manifest", d_manifest_unlisted_file, True),
    "spine_bad_idref": ("manifest", d_spine_bad_idref, True),
    "media_type_wrong": ("manifest", d_media_type_wrong, True),
    "href_spaces": ("manifest", d_href_spaces, True),
    "meta_no_language": ("metadata", d_meta_no_language, True),
    "meta_unknown_author": ("metadata", d_meta_unknown_author, True),
    "meta_no_author": ("metadata", d_meta_no_author, True),
    "meta_filename_title": ("metadata", d_meta_filename_title, True),
    "meta_no_title": ("metadata", d_meta_no_title, True),
    "meta_uid_mismatch": ("metadata", d_meta_uid_mismatch, True),
    "meta_no_modified": ("metadata", d_meta_no_modified, False),
    "toc_ncx_broken": ("toc", d_toc_ncx_broken, True),
    "toc_nav_missing": ("toc", d_toc_nav_missing, False),
    "font_corrupt": ("font", d_font_corrupt, True),
    "duplicate_ids": ("xhtml", d_duplicate_ids, True),
}
# container-level defects that make the zip unreadable to most tools are kept apart
# from the rest so a multi-defect file still exercises the other fixers.
CONTAINER = {k for k, v in DEFECTS.items() if v[0] == "container"}


def write_epub(files, path, mimetype_last=False, mimetype_deflate=False):
    order = [k for k in files if k != "mimetype"]
    with zipfile.ZipFile(path, "w") as z:
        if "mimetype" in files and not mimetype_last:
            z.writestr(zipfile.ZipInfo("mimetype"), files["mimetype"],
                       compress_type=zipfile.ZIP_DEFLATED if mimetype_deflate else zipfile.ZIP_STORED)
        for k in order:
            z.writestr(k, files[k], compress_type=zipfile.ZIP_DEFLATED)
        if "mimetype" in files and mimetype_last:
            z.writestr("mimetype", files["mimetype"], compress_type=zipfile.ZIP_STORED)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", default=str(Path(__file__).parent / "files"))
    ap.add_argument("--broken-per-book", type=int, default=4)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    (out / "clean").mkdir(parents=True); (out / "broken").mkdir(); (out / "real").mkdir()
    rows = []
    for bi, b in enumerate(BOOKS):
        style = STYLES[bi % 3]
        files, meta = build_book(b, style, rng, font=rng.random() < 0.3)
        name = f"{slug(b[0])}-{style}"
        # Hold out whole books (never just some of a book's broken copies), so
        # nothing a fixer is tuned on leaks into the score that matters.
        split = "heldout" if bi % 5 == 4 else "tuning"
        meta["split"] = split
        write_epub(files, out / "clean" / f"{name}.epub")
        rows.append({"file": f"clean/{name}.epub", "defects": [], **meta})
        names = [k for k, v in DEFECTS.items() if v[2] or meta["epub_version"] == "3.0"]
        for j in range(args.broken_per_book):
            f2 = dict(files)
            # first copy: one defect; others: 2-3 defects, at most one container-level
            n = 1 if j == 0 else rng.randint(2, 3)
            picked = []
            while len(picked) < n:
                d = rng.choice(names)
                if d in picked or (d in CONTAINER and any(p in CONTAINER for p in picked)):
                    continue
                if d == "href_spaces" and "manifest_missing_file" in picked or d == "manifest_missing_file" and "href_spaces" in picked:
                    continue
                picked.append(d)
            flags = {}
            for d in sorted(picked, key=lambda x: x in CONTAINER):  # container defects last
                flags.update(DEFECTS[d][1](f2, rng) or {})
            fname = f"broken/{name}--{j}.epub"
            write_epub(f2, out / fname, **flags)
            rows.append({"file": fname, "defects": picked,
                         "categories": sorted({DEFECTS[d][0] for d in picked}), **meta})
    # real-world files bundled with the tools we could install
    reals = [Path("/usr/share/calibre/quick_start").glob("*.epub"),
             Path("/usr/local/lib/python3.13/dist-packages/epubcheck/samples").glob("*.epub")]
    for g in reals:
        for p in g:
            dst = out / "real" / f"{p.parent.name}-{p.name}"
            shutil.copy(p, dst)
            rows.append({"file": f"real/{dst.name}", "defects": None, "style": "real", "split": "real"})
    for extra in Path(__file__).parent.glob("extra/*.epub"):
        shutil.copy(extra, out / "real" / extra.name)
        rows.append({"file": f"real/{extra.name}", "defects": None, "style": "real", "split": "real"})
    (Path(__file__).parent / "manifest.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False))
    print(f"{len(rows)} files -> {out}")


if __name__ == "__main__":
    main()
