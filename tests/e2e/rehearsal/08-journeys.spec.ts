import "../env";
import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import type { Page } from "@playwright/test";
import { wp } from "../env";
import { waitForState } from "./helpers";

/*
 * Journeys (0.31): with History on, a visitor's pages become a journey row WordSocket keeps, the
 * Journeys tab draws the last 28 days, and the Moments tab's replay has a provider.
 */

const TAB = "page=wordsocket&tab=journeys";

async function arrive(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForState(page, { connected: true, transport: "ws" });
}

test.describe("Journeys", () => {
  let before = "";
  let startedAt = "";

  test.beforeAll(() => {
    try {
      before = wp("option", "get", "wpsignal_history_enabled");
    } catch {
      before = "";
    }
    startedAt = wp("eval", "echo gmdate('Y-m-d H:i:s');");
    wp("option", "update", "wpsignal_history_enabled", "1");
    wp("cache", "flush");
  });

  test.afterAll(() => {
    const table = `${wp("db", "prefix")}wpsignal_journeys`;
    wp("db", "query", `DELETE FROM ${table} WHERE started_at >= '${startedAt}'`);
    if (before) wp("option", "update", "wpsignal_history_enabled", before);
    else wp("option", "delete", "wpsignal_history_enabled");
    wp("cache", "flush");
  });

  test("a visitor's pages are kept as a journey, drawn on the tab, and offered to the replay", async ({ admin, page, browser, baseURL }) => {
    // A guest browses the front page and a second page: one journey, two steps.
    const visitor = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
    const shop = await visitor.newPage();
    await arrive(shop, "/");
    await shop.waitForTimeout(1500);
    const link = shop.locator("article a[href], .entry-title a, h2 a").first();
    const href = await link.getAttribute("href");
    await shop.goto(href ?? "/?s=a");
    await waitForState(shop, { connected: true, transport: "ws" });
    await shop.waitForTimeout(1500);
    const journeyId = await shop.evaluate(() => {
      const raw = window.sessionStorage.getItem("wordsocket-journey");
      return raw ? (JSON.parse(raw) as { n: string }).n : "";
    });
    expect(journeyId).toMatch(/^[0-9a-f-]{36}$/);
    await visitor.close();

    // The row: two steps, under the visitor's journey id.
    const table = `${wp("db", "prefix")}wpsignal_journeys`;
    await expect
      .poll(() => Number(wp("db", "query", `SELECT steps FROM ${table} WHERE journey_id = '${journeyId}'`, "--skip-column-names")), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);

    // The tab draws it.
    await admin.visitAdminPage("admin.php", TAB);
    await expect(page.getByRole("tab", { name: "Journeys" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Keep a history of journeys")).toBeChecked();
    await expect(page.locator(".wpsignal-net")).toBeVisible({ timeout: 20_000 });
    expect(await page.locator(".wpsignal-net__journey").count()).toBeGreaterThan(0);
    await expect(page.locator(".wpsignal-trend__dot").first()).toBeVisible();
    // A three-second visit rounds to no minutes: count the visit itself.
    const hours = page.locator(".wpsignal-visual").nth(2);
    await hours.locator("[role=combobox]").first().click();
    await page.getByRole("option", { name: "Visits", exact: true }).click();
    await expect.poll(() => page.locator(".wpsignal-hours__cell:not(.is-empty)").count()).toBeGreaterThan(0);
    const trends = page.locator(".wpsignal-visual").nth(1);
    await trends.getByRole("tab", { name: "Table" }).click();
    await expect(trends.locator(".wpsignal-chart__table tbody tr")).toHaveCount(28);
    await trends.getByRole("tab", { name: "Chart" }).click();
    await expect(trends.locator("svg[role=img]")).toBeVisible();

    // The Moments tab's replay has WordSocket's own provider.
    await admin.visitAdminPage("admin.php", "page=wordsocket&tab=moments&moment=new");
    await expect(page.locator(".wpsignal-rule-replay")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".wpsignal-rule-replay")).toContainText("If this moment were on");
  });

  test("with History off the tab offers the switch alone and the replay has no provider", async ({ admin, page }) => {
    wp("option", "update", "wpsignal_history_enabled", "0");
    try {
      await admin.visitAdminPage("admin.php", TAB);
      await expect(page.getByLabel("Keep a history of journeys")).not.toBeChecked();
      await expect(page.locator(".wpsignal-visual")).toHaveCount(0);
      await admin.visitAdminPage("admin.php", "page=wordsocket&tab=moments&moment=new");
      await expect(page.getByRole("heading", { name: "New Moment" })).toBeVisible();
      await expect(page.locator(".wpsignal-rule-replay")).toHaveCount(0);
      // The switch turns it on and the visuals appear.
      await admin.visitAdminPage("admin.php", TAB);
      await page.getByLabel("Keep a history of journeys").check();
      await expect(page.locator(".components-snackbar")).toContainText("Settings saved.");
      expect(wp("option", "get", "wpsignal_history_enabled")).toBe("1");
    } finally {
      wp("option", "update", "wpsignal_history_enabled", "1");
    }
  });
});
