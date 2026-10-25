// The Library's database schema, as ordered migrations. Never edit a shipped
// migration; add the next one. Each runs in one transaction and bumps
// user_version, and a tagged backup is taken before any step runs on a
// Library that already has books (see Library.open).

export const MIGRATIONS: string[] = [
  // 1: Release 1
  `
  CREATE TABLE books (
    id INTEGER PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,          -- sha256 of the original file
    title TEXT NOT NULL,
    authors TEXT NOT NULL,              -- JSON array, display order
    author_sort TEXT NOT NULL,          -- "Le Guin, Ursula K."
    series TEXT,
    series_index REAL,
    language TEXT NOT NULL DEFAULT '',
    publisher TEXT,
    year INTEGER,
    isbn TEXT,
    description TEXT,
    file TEXT NOT NULL,                 -- the fixed book, relative: books/Author/Title.epub
    original TEXT NOT NULL,             -- never changed, relative: originals/<hash>.epub
    cover TEXT,                         -- relative: covers/<id>.jpg
    size INTEGER NOT NULL,
    state TEXT NOT NULL,                -- ready | fixed | review
    plan TEXT NOT NULL,                 -- JSON FixPlan: replaying it on the original rebuilds the book
    report TEXT NOT NULL,               -- JSON FixReport from the last build
    origin TEXT NOT NULL,               -- import | calibre
    origin_name TEXT NOT NULL,          -- the file name it arrived as
    added_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    removed_at TEXT                     -- set while in Removed; purged after 30 days
  );
  CREATE INDEX books_live ON books(removed_at, state);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE history (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL,                -- "Accept suggested details", shown as Undo <label>
    steps TEXT NOT NULL,                -- JSON [{id, before, after}] of book snapshots
    at TEXT NOT NULL
  );
  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                 -- import | calibre | kobo
    label TEXT NOT NULL,
    items TEXT NOT NULL,                -- JSON array; each item is safe to run twice
    done INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL,                -- queued | running | done | cancelled
    results TEXT NOT NULL DEFAULT '[]', -- JSON array, one per finished item
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  `,
];
