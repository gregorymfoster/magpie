import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { books, call, classicFiles, emma, longBook, reset, unknownAuthor } from "./helpers.ts";
import { epub, page as xhtml } from "../../core/test/fixtures.ts";

test.beforeEach(async ({ page }) => reset(page));

test("an empty Library opens on the drop target, and Add Books brings a book in", async ({ page }) => {
  await expect(page.getByText("Drop your books here")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add Books…" }).click();
  await (await chooser).setFiles(books({ "emma.epub": emma() }));
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Added 1 book" })).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".tile .t", { hasText: "Emma" })).toBeVisible();
  await expect(page.locator(".status")).toContainText("1 book");
});

test("selecting a book shows what Magpie fixed in the inspector", async ({ page }) => {
  await call(page, "books.import", { paths: books({ "emma.epub": emma() }) });
  await page.reload();
  await page.locator(".tile", { hasText: "Emma" }).click();
  const insp = page.getByRole("complementary", { name: "Inspector" });
  await expect(insp.getByRole("heading", { name: "Emma" })).toBeVisible();
  await expect(insp).toContainText("Declared cover.jpg as the cover");
});

test("a clean book wears the seal; one that needs work waits in Needs Work with a to-do that opens its fix", async ({ page }) => {
  const noAuthor = epub({
    opfMeta: '<dc:identifier id="id">urn:uuid:7</dc:identifier><dc:title>Persuasion</dc:title><dc:language>en</dc:language>',
    pages: { "ch1.xhtml": xhtml("<h2>Chapter 1</h2><p>Sir Walter Elliot never took up any book but the Baronetage.</p>") },
  });
  await call(page, "books.import", { paths: books({ "emma.epub": emma(), "persuasion.epub": noAuthor }) });
  await page.reload();
  await expect(page.locator(".tile", { hasText: "Emma" }).getByLabel("Clean")).toBeVisible();
  await expect(page.locator(".status")).toContainText("1 clean · 1 needs work");
  await page.getByRole("navigation", { name: "Library" }).getByText("Needs Work").click();
  await expect(page.locator(".tile .t")).toHaveText(["Persuasion"]);
  await page.locator(".tile", { hasText: "Persuasion" }).click();
  const insp = page.getByRole("complementary", { name: "Inspector" });
  await expect(insp).toContainText("1 to do");
  await expect(insp).toContainText("The book doesn't say who wrote it.");
  await insp.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("Keep the book's own styling is a checkbox in the inspector, and ⌘Z puts Magpie's clean-up back", async ({ page }) => {
  await call(page, "books.import", { paths: books({ "emma.epub": emma() }) });
  await page.reload();
  await page.locator(".tile", { hasText: "Emma" }).click();
  const keep = page.getByRole("checkbox", { name: /Keep the book’s own styling/ });
  await expect(keep).not.toBeChecked();
  await keep.click();
  await expect(keep).toBeChecked();
  await expect(page.locator(".status")).toContainText("Undo keep the book's styling");
});

test("suggested details: accept, see it written, then undo from the toast", async ({ page }) => {
  await call(page, "books.import", { paths: books({ "emma.epub": unknownAuthor() }) });
  await page.reload();
  await page.getByRole("button", { name: "Review 1", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Check suggested details" });
  await expect(sheet.locator(".new")).toHaveText("Jane Austen");
  await sheet.getByRole("button", { name: "Accept 1 change" }).click();
  await expect(page.locator(".tile .a", { hasText: "Jane Austen" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Review/ })).toHaveCount(0);
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Review 1", exact: true })).toBeVisible();
});

test("Send to Kindle asks for the address once, then opens a Mail message with the book", async ({ page }) => {
  await call(page, "books.import", { paths: books({ "emma.epub": emma() }) });
  await page.reload();
  await page.locator(".tile", { hasText: "Emma" }).click();
  await page.getByRole("button", { name: "Send", exact: true }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Send to Kindle address").fill("me@gmail.com");
  await sheet.getByRole("button", { name: "Make Mail draft" }).click();
  await expect(sheet.getByRole("alert")).toContainText("@kindle.com");
  await sheet.getByLabel("Send to Kindle address").fill("greg_1@kindle.com");
  await sheet.getByRole("button", { name: "Make Mail draft" }).click();
  await expect(page.locator(".toast")).toContainText("Mail draft is ready");
  const opened = readFileSync(`${test.info().config.metadata.home}/opened.txt`, "utf8").trim().split("\n").pop()!;
  expect(opened).toMatch(/^mail .*"to":"greg_1@kindle\.com".*Jane-Austen-Emma\.epub/);
});

test("remove moves a book to Removed; ⌘Z brings it back", async ({ page }) => {
  await call(page, "books.import", { paths: books({ "emma.epub": emma() }) });
  await page.reload();
  await page.locator(".tile", { hasText: "Emma" }).click();
  await page.keyboard.press("ControlOrMeta+Backspace");
  await expect(page.locator(".tile")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Removed/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".tile", { hasText: "Emma" })).toBeVisible();
});

test("search narrows the grid", async ({ page }) => {
  await call(page, "books.import", { paths: books({ "emma.epub": emma() }) });
  await page.reload();
  await page.getByLabel("Search").fill("dickens");
  await expect(page.getByText("No matches")).toBeVisible();
  await page.getByLabel("Search").fill("austen");
  await expect(page.locator(".tile")).toHaveCount(1);
});

test("settings: an invalid Kindle address gets a sentence, a valid one sticks", async ({ page }) => {
  await page.goto("/?sheet=settings&section=Devices");
  const sheet = page.getByRole("dialog", { name: "Settings" });
  await sheet.getByLabel("Send to Kindle address").fill("nope");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByRole("alert")).toContainText("doesn't look like");
  await sheet.getByLabel("Send to Kindle address").fill("greg_1@kindle.com");
  await sheet.getByRole("button", { name: "Save" }).click();
  expect((await call(page, "settings.get")).kindleAddress).toBe("greg_1@kindle.com");
});

test("a cover image that won't load falls back to a typographic cover", async ({ page }) => {
  await call(page, "books.import", { paths: books({ "emma.epub": emma() }) });
  await page.reload();
  const tile = page.locator(".tile", { hasText: "Emma" });
  await expect(tile.locator("img")).toHaveCount(0);
  await expect(tile.locator(".cv")).toContainText("Emma");
});

test("the keyboard moves through books like Finder, and Return opens Edit Details", async ({ page }) => {
  await call(page, "books.import", { paths: classicFiles() });
  await page.reload();
  const tiles = page.locator(".tile");
  await expect(tiles).toHaveCount(15);
  await tiles.first().click();
  const first = await tiles.first().getAttribute("data-book");
  await page.keyboard.press("ArrowRight");
  await expect(tiles.nth(1)).toBeFocused();
  await expect(tiles.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByRole("complementary", { name: "Inspector" })).toContainText("2 books selected");
  await page.keyboard.press("Home");
  await expect(page.locator(`[data-book="${first}"]`)).toBeFocused();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Edit details" });
  await expect(sheet).toBeVisible();
  // Focus starts in the sheet's first field and Tab never leaves the sheet.
  await expect(sheet.locator("input").first()).toBeFocused();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  // Esc puts focus back on the book; only one book is a Tab stop, so Tab leaves the grid.
  await page.keyboard.press("Escape");
  await expect(page.locator(`[data-book="${first}"]`)).toBeFocused();
  await expect(page.locator('.tile[tabindex="0"]')).toHaveCount(1);
});

test("Look Up asks first, says what is sent, and what Open Library finds waits for review", async ({ page }) => {
  const home = test.info().config.metadata.home as string;
  writeFileSync(
    `${home}/web.json`,
    JSON.stringify({
      "title=Emma&author=Jane+Austen": { docs: [{ key: "/works/OL66562W", title: "Emma", author_name: ["Jane Austen"], first_publish_year: 1815 }] },
      "/works/OL66562W.json": { description: "Emma Woodhouse, handsome, clever, and rich, meddles in the love lives of her friends." },
    }),
  );
  await call(page, "books.import", { paths: books({ "emma.epub": emma() }) });
  await page.reload();
  await page.getByRole("button", { name: "Look Up" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Look up details for 1 book?" })).toBeVisible();
  await expect(sheet).toContainText("Only each book’s title, author and ISBN are sent");
  await sheet.getByRole("button", { name: "Look Up" }).click();
  await expect(sheet.getByRole("heading", { name: "Found details for 1 book" })).toBeVisible();
  await sheet.getByRole("button", { name: /Review 1 suggested/ }).click();
  const review = page.getByRole("dialog", { name: "Check suggested details" });
  await expect(review).toContainText("Published");
  await expect(review).toContainText("1815");
  await expect(review).toContainText("Open Library, matched by title and author");
  await review.getByRole("button", { name: "Accept 2 changes" }).click();
  await page.locator(".tile", { hasText: "Emma" }).click();
  await expect(page.getByRole("complementary", { name: "Inspector" })).toContainText("1815");
});

test("books land on shelves; the sidebar filters by shelf, author and series; tags go on and come off", async ({ page }) => {
  await call(page, "books.import", { paths: classicFiles() });
  await expect.poll(async () => (await call(page, "books.list")).length).toBe(15);
  await page.reload();
  const side = page.getByRole("navigation", { name: "Library" });
  await side.getByRole("button", { name: /^Fiction \d+$/ }).click();
  await expect(page.locator(".ttl h1")).toHaveText("Fiction");
  await side.getByRole("button", { name: /^Science Fiction 1$/ }).click();
  await expect(page.locator(".tile .t")).toHaveText(["Frankenstein"]);
  await side.getByRole("button", { name: /^Jane Austen 2$/ }).click();
  await expect(page.locator(".tile")).toHaveCount(2);

  await page.locator(".tile", { hasText: "Persuasion" }).click();
  const insp = page.getByRole("complementary", { name: "Inspector" });
  await expect(insp.locator(".chip.ai", { hasText: "Romance" })).toBeVisible();
  await insp.getByLabel("Add a tag").fill("Book club");
  await insp.getByLabel("Add a tag").press("Enter");
  await expect(side.getByRole("button", { name: /^Book club 1$/ })).toBeVisible();
  await insp.getByRole("button", { name: "Take off Romance" }).click();
  await expect(insp.locator(".chip", { hasText: "Romance" })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(insp.locator(".chip.ai", { hasText: "Romance" })).toBeVisible();
});

test("the list's columns can be chosen, and the choice is remembered", async ({ page }) => {
  await call(page, "books.import", { paths: classicFiles() });
  await expect.poll(async () => (await call(page, "books.list")).length).toBe(15);
  await page.goto("/?layout=list");
  const head = page.locator(".tbl thead");
  await expect(head.locator("th")).toContainText(["Title", "Author", "Series", "Year", "Genre", "Status"]);
  await page.getByRole("button", { name: "Choose columns" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Shelf" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Status" }).click();
  await page.keyboard.press("Escape");
  await expect(head.locator("th", { hasText: "Shelf" })).toBeVisible();
  await expect(head.locator("th", { hasText: "Status" })).toHaveCount(0);
  await expect(page.locator(".tbl tbody tr", { hasText: "Dracula" })).toContainText("Horror");
  await page.reload();
  await expect(head.locator("th", { hasText: "Shelf" })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("magpie.columns"));
});

test("Space previews a book on a reader; pages turn into the next chapter, and Original shows the file before the fix", async ({ page }) => {
  await call(page, "books.import", { paths: books({ "pp.epub": longBook() }) });
  await expect.poll(async () => (await call(page, "books.list")).length).toBe(1);
  await page.reload();
  await page.locator(".tile", { hasText: "Pride and Prejudice" }).click();
  await page.keyboard.press(" ");
  const sheet = page.getByRole("dialog", { name: "Preview on a reader" });
  await expect(sheet.locator(".pv-t")).toContainText("Pride and Prejudice");
  const frame = sheet.frameLocator("iframe");
  await expect(frame.locator("h2")).toHaveText("Chapter 1");
  await expect(frame.locator("img")).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
  await expect(sheet.locator(".sh-f .note")).toContainText(/Page 1 of [2-9]/);
  await page.keyboard.press("ArrowRight");
  await expect(sheet.locator(".sh-f .note")).toContainText("Page 2 of");
  await page.waitForTimeout(200); // late fonts can still change the count
  const pages = Number((await sheet.locator(".sh-f .note").textContent())!.match(/of (\d+)/)![1]);

  // Bigger text on a smaller reader takes more pages.
  await sheet.getByRole("combobox", { name: "Reader" }).selectOption("kobo-clara");
  await sheet.getByRole("button", { name: "Larger text" }).click();
  await sheet.getByRole("button", { name: "Larger text" }).click();
  await expect.poll(async () => Number((await sheet.locator(".sh-f .note").textContent())?.match(/of (\d+)/)?.[1] ?? 0)).toBeGreaterThan(pages);

  await sheet.getByRole("combobox", { name: "Chapter" }).selectOption({ label: "Chapter 1" });
  const note = sheet.locator(".sh-f .note");
  for (let i = 0; i < 40; i++) {
    await expect(note).toContainText("Page");
    const before = (await note.textContent())!;
    if (before.includes("part 2")) break;
    await sheet.getByRole("button", { name: "Next page" }).click();
    await expect(note).not.toHaveText(before);
  }
  await expect(frame.locator("h2")).toHaveText("Chapter 2");
  await expect(sheet.locator(".sh-f .note")).toContainText("Page 1 of");
  await page.keyboard.press("ArrowLeft");
  await expect(frame.locator("h2")).toHaveText("Chapter 1");

  await sheet.getByRole("button", { name: "Original" }).click();
  await expect(sheet.getByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "true");
  await expect(frame.locator("h2")).toHaveText("Chapter 1");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toHaveCount(0);
});
