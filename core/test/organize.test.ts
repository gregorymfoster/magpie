// Shelves: sorting books into Fiction and Nonfiction, genres and vibes, by
// rules first and a local model second, and the tags a person adds or takes off.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCore, type Host } from "../src/index.ts";
import { byRules, Organizer } from "../src/organize/organize.ts";
import { GENRES, VIBES } from "../src/organize/vocabulary.ts";
import { nodeHost } from "../../cli/src/node-host.ts";
import { epub } from "./fixtures.ts";

function setup(change: (h: Host) => Host = (h) => h) {
  const home = mkdtempSync(join(tmpdir(), "magpie-test-"));
  // Rules alone; the model's part is tested with a stand-in below and scored for real by bench/organize.ts.
  const host = change(
    nodeHost({ MAGPIE_HOME: home, MAGPIE_VOLUMES: join(home, "Volumes"), MAGPIE_OPENED: join(home, "opened.txt"), MAGPIE_MODEL: "/no-model" }),
  );
  const core = createCore(host);
  let n = 0;
  const add = async (meta: string) => {
    const p = join(home, "Downloads", `b${++n}.epub`);
    mkdirSync(join(home, "Downloads"), { recursive: true });
    writeFileSync(
      p,
      epub({ opfMeta: `<dc:identifier id="id">urn:uuid:${n}</dc:identifier><dc:language>en</dc:language><dc:creator>Jane Austen</dc:creator>${meta}` }),
    );
    await core.call("books.import", { paths: [p] });
    await core.idle();
    return (await core.call("books.list")).find((b) => b.title === meta.match(/<dc:title>([^<]*)/)![1])!;
  };
  return { home, core, add };
}

const names = (b: { tags: { name: string }[] }) => b.tags.map((t) => t.name);

test("subjects the book already carries put it on a shelf as it comes in", async () => {
  const { core, add } = setup();
  await core.call("app.state");
  const dune = await add("<dc:title>Dune</dc:title><dc:subject>FICTION / Science Fiction / Space Opera</dc:subject>");
  assert.deepEqual(names(dune), ["Fiction", "Science Fiction"]);
  assert.equal(dune.tags[0].by, "magpie");
  assert.equal(dune.tags[0].source, "the book's subjects");
  const lean = await add("<dc:title>The Lean Startup</dc:title><dc:subject>Business &amp; Economics</dc:subject><dc:subject>Entrepreneurship</dc:subject>");
  assert.deepEqual(names(lean), ["Nonfiction", "Business"]);
  const plain = await add("<dc:title>Untitled Thing</dc:title>");
  assert.deepEqual(names(plain), [], "nothing to go on and no model: no guess");

  const g = await core.call("library.groups");
  assert.deepEqual(g.shelves, [
    { name: "Fiction", count: 1, genres: [{ name: "Science Fiction", count: 1 }] },
    { name: "Nonfiction", count: 1, genres: [{ name: "Business", count: 1 }] },
  ]);
  assert.deepEqual(g.authors, [{ name: "Jane Austen", count: 3 }]);
  assert.equal(g.unsorted, 0);
  assert.deepEqual(
    (await core.call("books.list", { tag: "Fiction" })).map((b) => b.title),
    ["Dune"],
  );
  assert.deepEqual(
    (await core.call("books.list", { search: "science fiction" })).map((b) => b.title),
    ["Dune"],
    "search finds tags",
  );
  assert.equal((await core.call("books.list", { author: "Jane Austen" })).length, 3);
});

test("a person's tags stay, a tag they take off stays off, and both undo", async () => {
  const { core, add } = setup();
  await core.call("app.state");
  const dune = await add("<dc:title>Dune</dc:title><dc:subject>Science fiction</dc:subject>");
  await core.call("books.tag", { ids: [dune.id], add: ["  Book   club ", "book club"], remove: ["Science Fiction"] });
  let b = await core.call("books.get", { id: dune.id });
  assert.deepEqual(names(b), ["Fiction", "Book club"]);
  assert.equal((await core.call("app.state")).undo, "Add tag");

  await core.call("library.organize", { again: true });
  await core.idle();
  b = await core.call("books.get", { id: dune.id });
  assert.deepEqual(names(b), ["Fiction", "Book club"], "sorting again keeps Book club and leaves Science Fiction off");

  await core.call("history.undo"); // the sort changed nothing worth a step, so this undoes the tag edit
  b = await core.call("books.get", { id: dune.id });
  assert.deepEqual(names(b), ["Fiction", "Science Fiction"]);
});

test("a Library from before shelves is sorted once in the background, as one undo step", async () => {
  const { core, home, add } = setup();
  await core.call("app.state");
  await add("<dc:title>Dune</dc:title><dc:subject>Science fiction</dc:subject>");
  await add("<dc:title>Emma</dc:title><dc:subject>Love stories</dc:subject>");
  await core.close();
  // Wipe the shelves, as if the books came in with an older Magpie.
  const db = new DatabaseSync(join(home, "Books/Magpie/library.db"));
  db.exec("UPDATE books SET tags = '[]', organized = NULL; DELETE FROM history;");
  db.close();

  const again = createCore(nodeHost({ MAGPIE_HOME: home, MAGPIE_VOLUMES: join(home, "Volumes"), MAGPIE_MODEL: "/no-model" }));
  const s = await again.call("app.state");
  assert.ok(s.jobs.some((j) => j.kind === "organize"));
  await again.idle();
  assert.deepEqual((await again.call("books.list", { tag: "Fiction" })).length, 2);
  assert.equal((await again.call("app.state")).undo, "Sort Library");
  await again.call("history.undo");
  assert.deepEqual((await again.call("books.list", { tag: "Fiction" })).length, 0);
  assert.equal((await again.call("library.groups")).unsorted, 0, "undo puts the tags back, but doesn't ask to sort again");
});

test("turning sorting off leaves new books unsorted", async () => {
  const { core, add } = setup();
  await core.call("settings.set", { organize: false });
  const dune = await add("<dc:title>Dune</dc:title><dc:subject>Science fiction</dc:subject>");
  assert.deepEqual(names(dune), []);
  assert.equal((await core.call("library.groups")).unsorted, 1);
});

test("rules: a Fiction heading is a strong vote, not the last word; titles count", () => {
  const titan = byRules({
    title: "Titan",
    subjects: ["Corporate & Business History", "Business", "Fiction", "Biography & Autobiography", "Business & Economics"],
  });
  assert.equal(titan.kind?.name, "Nonfiction");
  assert.deepEqual(byRules({ title: "Infinite Jest: A Novel", subjects: ["Literature"] }).kind?.name, "Fiction");
  assert.deepEqual(
    byRules({ title: "Black Light: Stories", subjects: [] }).genres.map((g) => g.name),
    ["Short Stories"],
  );
  const norwegian = byRules({ title: "Norwegian Wood", subjects: ["Contemporary", "General", "Romance", "Literary", "Fiction", "Fiction - General"] });
  assert.deepEqual([norwegian.kind?.name, ...norwegian.genres.map((g) => g.name)], ["Fiction", "Romance"]);
});

// A stand-in model: a text is close to a shelf's description when they share words.
const fakeEmbed = async (texts: string[]) =>
  texts.map((t) => {
    const v = new Float32Array(256);
    for (const w of t.toLowerCase().match(/[a-z]{4,}/g) ?? []) v[[...w].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 256, 7)] += 1;
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  });

test("the model fills only what the rules left empty, and only when it's sure", async () => {
  const org = new Organizer(fakeEmbed);
  const sf = GENRES.find((g) => g.name === "Science Fiction")!.about;
  const guesses = await org.guess({ title: "Starship", description: `${sf} ${sf}`, subjects: [] });
  assert.equal(guesses[0].name, "Fiction");
  assert.equal(guesses[1].name, "Science Fiction");
  assert.equal(guesses[1].source, "Magpie's model");
  assert.ok(guesses.every((g) => g.confidence >= 0.8));
  const ruled = await org.guess({ title: "Emma", description: `${sf} ${sf}`, subjects: ["Love stories"] });
  assert.deepEqual(
    ruled.slice(0, 2).map((g) => [g.name, g.source]),
    [
      ["Fiction", "the book's subjects"],
      ["Romance", "the book's subjects"],
    ],
    "rules win over the model",
  );
  const vague = await org.guess({
    title: "Notes",
    description: "a bit of the old and the new, up and so on, day by day, for you and me, all the way out and in.",
    subjects: [],
  });
  assert.deepEqual(vague, [], "unsure: no guess");
  assert.equal(VIBES.length, 10);
});

test("a locked book can be sorted, since tags live in the Library and not in the file", async () => {
  const { core, home } = setup();
  await core.call("app.state");
  const enc =
    '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><CipherData><CipherReference URI="ch1.xhtml"/></CipherData></EncryptedData></encryption>';
  const p = join(home, "locked.epub");
  writeFileSync(
    p,
    epub({
      opfMeta:
        '<dc:identifier id="id">urn:uuid:9</dc:identifier><dc:title>Dune</dc:title><dc:language>en</dc:language><dc:subject>Science Fiction</dc:subject>',
      extra: { "META-INF/encryption.xml": enc, "META-INF/rights.xml": "<rights/>" },
    }),
  );
  await core.call("books.import", { paths: [p] });
  await core.idle();
  const [b] = await core.call("books.list");
  assert.equal(b.state, "locked");
  assert.deepEqual(names(b), ["Fiction", "Science Fiction"]);
  await core.call("books.tag", { ids: [b.id], add: ["Reread"] });
  assert.deepEqual(names(await core.call("books.get", { id: b.id })), ["Fiction", "Science Fiction", "Reread"]);
});
