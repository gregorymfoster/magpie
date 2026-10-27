// Every error a person can see, as a sentence with a next step. Kept in one
// file so the voice stays the same and nothing raw ("ENOENT", "os error 2")
// reaches the screen.

const SENTENCES: Record<string, string> = {
  "not-a-zip": "This file isn't an EPUB Magpie can read. It may be a PDF or a document with the wrong ending.",
  "not-epub": "Magpie only reads EPUB books for now. MOBI, AZW3 and PDF are on the list.",
  drm: "Added, but it's locked with DRM by the store that sold it. Magpie lists it as it is and can't fix, edit or send it.",
  "locked-edit": "This book is locked with DRM, so Magpie leaves it exactly as the store made it. Its details can't be changed.",
  "locked-preview": "This book is locked with DRM, so its pages can't be shown here. Read it with the app from the store that sold it.",
  "preview-empty": "This book has no pages of text to show.",
  "locked-send": "Books locked with DRM can't be sent from Magpie. Read them with the app from the store that sold them.",
  empty: "This file is empty (0 bytes). Download it again from where it came from.",
  "too-large": "This book unpacks to more than 1.5 GB, which no real book does. Magpie stopped to be safe.",
  "too-many-files": "This book holds more than 20,000 files, which no real book does. Magpie stopped to be safe.",
  "no-library": "Your Library can't be found. If it's on an external disk, plug it in and try again.",
  "mail-failed":
    "Magpie couldn't open a message in Mail. If macOS asked whether Magpie may control Mail, allow it in System Settings › Privacy & Security › Automation, then try again.",
  "not-kindle-address": "That doesn't look like a Send to Kindle address. It ends in @kindle.com.",
  "empty-title": "A book needs a title.",
  "empty-author": "An author's name can't be blank. Leave the field empty for no author.",
  "bad-year": "The year should be four digits, like 1813.",
  "bad-series-number": "The series number should be a number, like 2 or 2.5.",
  "bad-language": "The language should be a code like en, fr or pt-BR.",
  "not-a-cover": "That file isn't a picture Magpie can use as a cover. Choose a JPEG or PNG.",
  "missing-file": "Magpie couldn't find this file. It may have been moved or deleted.",
  "no-book": "That book isn't in your Library any more.",
  "no-job": "That job has finished and is no longer listed.",
  "newer-library": "This Library was made by a newer version of Magpie. Update Magpie to open it.",
  "no-kindle-address": "Add your Send to Kindle address in Settings › Devices first.",
  "kindle-too-large": "Kindle takes at most 50 MB per email. Send fewer books at once.",
  "no-device": "That reader isn't connected any more. Plug it in and try again.",
  "device-full": "There isn't enough room on the reader for these books.",
  "calibre-missing": "Magpie couldn't find a Calibre library there. Choose the folder that holds metadata.db.",
  "calibre-file-missing": "Calibre lists this book, but its file isn't in the Calibre folder.",
  offline: "Magpie couldn't reach Open Library. Check the internet connection and look up again; books already done are kept.",
  "lookup-nothing": "Not enough to look up: the book has no usable title or ISBN.",
  "lookup-no-match": "Open Library has no clear match. Check the title and author, or fill in the details yourself.",
  "lookup-complete": "Nothing missing: the book already has a year, publisher, language and description.",
  "calibre-no-epub": "Calibre has this book only as MOBI, AZW3 or PDF, which Magpie can't read yet.",
};

/** A sentence for an error code, or for an unexpected error. */
export function explain(code: string): string {
  return SENTENCES[code] ?? "Something went wrong. Copy Diagnostics from the Magpie menu and open an issue on GitHub; it leaves out titles and contents.";
}

/** An error whose message is already a sentence for a person. */
export class UserError extends Error {
  code: string;
  constructor(code: string) {
    super(explain(code));
    this.code = code;
  }
}
