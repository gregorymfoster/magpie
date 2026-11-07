// Updates, the way Argus does them: a release downloads in the background with one quiet toast,
// then Restart to update waits at the right of the Status bar. In a browser `?update=` fakes
// where the app's updater stands (ui/src/shell.ts).
import { expect, test } from "@playwright/test";
import { books, call, emma, reset } from "./helpers.ts";

test.beforeEach(async ({ page }) => {
  await reset(page);
  await call(page, "books.import", { paths: books({ "emma.epub": emma() }) });
});

test("a release downloading in the background says so once and shows its progress in the Status bar", async ({ page }) => {
  await page.goto("/?update=downloading");
  await expect(page.locator(".toast", { hasText: "Magpie 0.1.10 is downloading" })).toBeVisible();
  await expect(page.getByTestId("status-update")).toContainText("Downloading 0.1.10");
  await expect(page.getByTestId("update-restart")).toHaveCount(0);
});

test("a downloaded release waits behind Restart to update, in the Status bar and a toast", async ({ page }) => {
  await page.goto("/?update=ready");
  await expect(page.getByTestId("update-restart")).toContainText("Restart to update");
  await expect(page.getByTestId("update-restart")).toContainText("0.1.10");
  const toast = page.locator(".toast", { hasText: "Magpie 0.1.10 is ready" });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: "Restart" })).toBeVisible();
});

test("Settings › Updates shows the version, the last check, what's new, and Restart to Update", async ({ page }) => {
  await page.goto("/?update=ready&sheet=settings&section=Updates");
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Magpie 0.1.9")).toBeVisible();
  await expect(sheet.getByText("Magpie 0.1.10 is installed. Restart to use it")).toBeVisible();
  await expect(sheet.getByTestId("settings-update-checked")).toHaveText("2 min ago");
  await expect(sheet.getByText("What’s new in 0.1.10")).toBeVisible();
  await expect(sheet.getByTestId("settings-update-restart")).toBeVisible();
});

test("Check Now reports that this is the newest version", async ({ page }) => {
  await page.goto("/?update=current&sheet=settings&section=Updates");
  const sheet = page.getByRole("dialog");
  await sheet.getByTestId("settings-update-check").click();
  await expect(sheet.getByText("You have the newest version.")).toBeVisible();
  await expect(sheet.getByTestId("settings-update-checked")).toHaveText("just now");
  await expect(page.getByTestId("status-update")).toHaveCount(0);
});

test("a browser build doesn't update itself, and says so", async ({ page }) => {
  await page.goto("/?sheet=settings&section=Updates");
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("This build doesn’t update itself")).toBeVisible();
  await expect(sheet.getByTestId("settings-update-check")).toBeDisabled();
  await expect(page.getByTestId("update-restart")).toHaveCount(0);
});
