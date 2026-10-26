import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { books, call, emma, reset, unknownAuthor } from "./helpers.ts";

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

test("Send to Kindle asks for the address once, then makes a Mail draft", async ({ page }) => {
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
  expect(readFileSync(opened, "utf8")).toContain("To: greg_1@kindle.com");
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
