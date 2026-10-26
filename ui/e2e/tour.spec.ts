// `just tour`: a walk through the app for a person to review. Stills of every
// screen with a realistic shelf, plus a video of the main flow, into ui/shots/tour/.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { call, classicFiles, reset } from "./helpers.ts";

test.skip(!process.env.SHOTS, "only with SHOTS=1 (just tour)");
test.setTimeout(120_000);

const OUT = "ui/shots/tour";
const home = () => test.info().config.metadata.home as string;
const tidy = (page: Page) =>
  page.evaluate(() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.textContent?.includes("/tmp/")) n.textContent = n.textContent.replace(/\/tmp\/magpie-e2e-\d+/, "~");
  });

async function seed(page: Page) {
  await reset(page);
  await call(page, "books.import", { paths: classicFiles() });
  await expect.poll(async () => (await call(page, "books.list")).length).toBe(15);
}

test("stills", async ({ browser }) => {
  mkdirSync(join(home(), "Volumes/KOBOeReader/.kobo"), { recursive: true });
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await reset(page);
  const id = async (title: string) => (await call(page, "books.list", { search: title }))[0].id;
  const shot = async (name: string, path: string, theme = "light") => {
    await page.goto(`${path}${path.includes("?") ? "&" : "?"}theme=${theme}`);
    await page.waitForTimeout(500);
    await tidy(page);
    await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
  };
  for (const theme of ["light", "dark"]) await shot("01-first-launch", "/", theme);
  await seed(page);
  const mm = await id("Middlemarch");
  const steps: [string, string][] = [
    ["02-library", `/?layout=grid&sel=${mm}`],
    ["03-list", `/?layout=list&sel=${mm}`],
    ["04-review", "/?layout=grid&sheet=review"],
    ["05-edit", `/?layout=grid&sel=${mm}&sheet=edit`],
    ["06-send", `/?layout=grid&sel=${mm}&sheet=send`],
    ["07-kobo", `/?layout=grid&view=kobo:${encodeURIComponent(join(home(), "Volumes/KOBOeReader"))}`],
    ["08-settings", "/?layout=grid&sheet=settings"],
    ["09-settings-devices", "/?sheet=settings&section=Devices"],
    ["10-flannel", `/?layout=grid&sel=${mm}&palette=flannel`],
  ];
  for (const theme of ["light", "dark"]) for (const [name, path] of steps) await shot(name, path, theme);
  await call(page, "books.remove", { ids: [await id("Dracula"), await id("Frankenstein")] });
  for (const theme of ["light", "dark"]) await shot("11-removed", "/?view=removed", theme);
  await ctx.close();
});

test("video", async ({ browser }) => {
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
  });
  const page = await ctx.newPage();
  const pause = (ms = 900) => page.waitForTimeout(ms);
  await reset(page);
  await pause(1200);

  // Add a shelf of books through the real Add Books… button.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add Books…" }).click();
  await (await chooser).setFiles(classicFiles());
  await expect(page.getByRole("heading", { name: /Added 15 books/ })).toBeVisible();
  await pause(1800);
  await page.getByRole("button", { name: "Done" }).click();
  await pause();

  // Look at what Magpie fixed in one book.
  await page.locator(".tile", { hasText: "Middlemarch" }).click();
  await pause(1800);
  await page.locator(".tile", { hasText: "Moby-Dick" }).click();
  await pause(1200);

  // Search.
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("austen", { delay: 90 });
  await pause(1400);
  await page.getByRole("textbox", { name: "Search" }).fill("");
  await page.locator(".grid, main").first().click({ position: { x: 5, y: 5 } });
  await pause();

  // Review the one suggestion, then undo it from the toast.
  await page.getByRole("button", { name: "Review 1", exact: true }).click();
  await pause(2200);
  await page.getByRole("button", { name: "Accept 1 change" }).click();
  await pause(1600);
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await pause(1400);

  // List view, then Send to Kindle.
  await page.keyboard.press("Meta+2");
  await pause(1400);
  await page.getByRole("row", { name: /^Persuasion/ }).click();
  await pause(700);
  await page.keyboard.press("Meta+Shift+s");
  await pause(1400);
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Send to Kindle address").fill("greg_1@kindle.com");
  await pause(900);
  await page.keyboard.press("Escape");
  await pause();

  // Settings.
  await page.keyboard.press("Meta+,");
  await pause(1600);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+1");
  await pause(1500);
  const video = page.video()!;
  await ctx.close();
  await video.saveAs(`${OUT}/tour.webm`);
});
