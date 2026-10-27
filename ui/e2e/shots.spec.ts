// `just shots`: every screen, light and dark, into ui/shots/. For a look
// without clicking; agents read these PNGs to check their own UI work.
import { expect, test } from "@playwright/test";
import { books, call, CLASSICS, classic, emma, longBook, reset, unknownAuthor } from "./helpers.ts";

test.skip(!process.env.SHOTS, "only with SHOTS=1 (just shots)");
// Stills show every screen at rest: no cover halfway through fading up, no book still rising in.
test.use({ reducedMotion: "reduce" });

const SCREENS: [string, string][] = [
  ["first-launch", "/"],
  ["library", "/?sel=1"],
  ["library-list", "/?layout=list&sel=1"],
  ["review", "/?sheet=review"],
  ["send", "/?sel=1&sheet=send"],
  ["edit", "/?sel=1&sheet=edit"],
  ["settings", "/?sheet=settings"],
  ["settings-devices", "/?sheet=settings&section=Devices"],
  ["flannel", "/?sel=1&palette=flannel"],
  ["preview-kindle", "/?sel=3&sheet=preview"],
  ["preview-kobo-libra", "/?sel=3&sheet=preview&reader=kobo-libra"],
  ["preview-iphone", "/?sel=3&sheet=preview&reader=iphone"],
];

test("screens", async ({ page }) => {
  await reset(page);
  for (const theme of ["light", "dark"]) {
    for (const [name, path] of SCREENS) {
      if (name === "library") await call(page, "books.import", { paths: books({ "emma.epub": emma(), "b.epub": unknownAuthor(), "pp.epub": longBook() }) });
      await page.goto(`${path}${path.includes("?") ? "&" : "?"}theme=${theme}`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `ui/shots/${name}-${theme}.png` });
    }
    await reset(page);
  }
});

/** The pictures on the website (site/img), at Retina size. */
test("hero", async ({ browser }) => {
  // Show the Library where it really lives, not in the test's temp folder.
  const tidy = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.textContent?.includes("/tmp/")) n.textContent = "~/Books/Magpie";
    });
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: { width: 1280, height: 780 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    await reset(page);
    await call(page, "books.import", { paths: books(Object.fromEntries(CLASSICS.map((c, i) => [`${i}.epub`, classic(c, i)]))) });
    await expect.poll(async () => (await call(page, "books.list")).length).toBe(CLASSICS.length);
    const first = (await call(page, "books.list", { search: "Middlemarch" }))[0].id;
    await page.goto(`/?sel=${first}&theme=${theme}`);
    await page.waitForTimeout(600);
    await tidy(page);
    await page.screenshot({ path: `ui/shots/hero-${theme}.png` });
    await page.goto(`/?sheet=review&theme=${theme}`);
    await page.waitForTimeout(600);
    await tidy(page);
    await page.screenshot({ path: `ui/shots/hero-review-${theme}.png` });
    await ctx.close();
  }
});
