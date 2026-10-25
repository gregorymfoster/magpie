// `just shots`: every screen, light and dark, into ui/shots/. For a look
// without clicking; agents read these PNGs to check their own UI work.
import { test } from "@playwright/test";
import { books, call, emma, reset, unknownAuthor } from "./helpers.ts";

test.skip(!process.env.SHOTS, "only with SHOTS=1 (just shots)");

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
];

test("screens", async ({ page }) => {
  await reset(page);
  for (const theme of ["light", "dark"]) {
    for (const [name, path] of SCREENS) {
      if (name === "library") await call(page, "books.import", { paths: books({ "emma.epub": emma(), "b.epub": unknownAuthor() }) });
      await page.goto(`${path}${path.includes("?") ? "&" : "?"}theme=${theme}`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `ui/shots/${name}-${theme}.png` });
    }
    await reset(page);
  }
});
