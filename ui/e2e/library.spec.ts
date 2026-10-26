import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { books, call, classicFiles, emma, reset, unknownAuthor } from "./helpers.ts";

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
