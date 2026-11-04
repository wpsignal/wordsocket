import "../env";
import { randomUUID } from "node:crypto";
import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import type { Page } from "@playwright/test";
import { wp } from "../env";
import { waitForState } from "./helpers";

/*
 * Journeys (0.31): with History on, a visitor's pages become a journey row WordSocket keeps, the
 * Journeys tab draws the last 28 days, and the Moments tab's replay has a provider. With History off
 * nothing new is written, but what was kept stays on the tab under a notice and in the replay. A
 * journey the browser never got to report (a crash) is sent from the outbox when the visitor is back.
 * A visit is written on a change of state (the first step, the tab hidden), not on every page.
 */

const TAB = "page=wordsocket&tab=journeys";

async function arrive(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForState(page, { connected: true, transport: "ws" });
  await engage(page);
}

/** The visitor's first interaction, which starts a new journey (WordSocket 0.31). */
async function engage(page: Page): Promise<void> {
  await page.mouse.move(12, 12);
  await page.mouse.move(48, 48);
}

/** Hide or show the tab, as a visibility change the page believes. */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (isHidden ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
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
    // A guest browses the front page and a second page: one journey, two steps, one visit request.
    const visitor = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
    const shop = await visitor.newPage();
    const visits: string[] = [];
    shop.on("request", (request) => {
      if (request.url().includes("/wpsignal/v1/visit")) visits.push(request.url());
    });
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
    expect(visits, "the first step wrote; the hop changed nothing worth a request").toHaveLength(1);
    // The tab goes hidden: a change of state, written at once with both pages.
    await setHidden(shop, true);
    await expect.poll(() => visits.length).toBe(2);
    await shop.waitForTimeout(500);
    await visitor.close();

    // The row: the two pages and the away, under the visitor's journey id.
    const table = `${wp("db", "prefix")}wpsignal_journeys`;
    await expect
      .poll(() => Number(wp("db", "query", `SELECT steps FROM ${table} WHERE journey_id = UNHEX('${journeyId.replace(/-/g, "")}')`, "--skip-column-names")), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3);

    // The tab draws it.
    await admin.visitAdminPage("admin.php", TAB);
    await expect(page.getByRole("tab", { name: "Journeys" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Keep a history of Journeys")).toBeChecked();

    // The download: a CSV of the last 28 days whose header is the legend's columns, served to this admin.
    const downloadHref = (await page.locator("a[href*='wpsignal_journeys_download']").first().getAttribute("href")) ?? "";
    expect(downloadHref).toContain("format=csv");
    expect(downloadHref).toContain("days=28");
    const file = await page.request.get(downloadHref);
    expect(file.headers()["content-type"]).toContain("text/csv");
    expect((await file.text()).split("\n")[0]).toBe("journey_id,visitor,user_id,ref,outcome,value,started_at,last_seen,steps,path,journey,firings,data");

    await expect(page.locator(".wpsignal-net")).toBeVisible({ timeout: 20_000 });
    expect(await page.locator(".wpsignal-net__journey").count()).toBeGreaterThan(0);
    // The weeks and hours cards open closed.
    const trends = page.locator(".wpsignal-visual").nth(1);
    const hours = page.locator(".wpsignal-visual").nth(2);
    await trends.getByRole("button").first().click();
    await hours.getByRole("button").first().click();
    await expect(page.locator(".wpsignal-trend__raw").first()).toBeVisible();
    // A three-second visit rounds to no minutes: count the visit itself.
    await hours.locator("[role=combobox]").first().click();
    await page.getByRole("option", { name: "Visits", exact: true }).click();
    await expect.poll(() => page.locator(".wpsignal-hours__cell:not(.is-empty)").count()).toBeGreaterThan(0);
    await trends.getByRole("tab", { name: "Table" }).click();
    await expect(trends.locator(".wpsignal-chart__table tbody tr")).toHaveCount(28);
    await trends.getByRole("tab", { name: "Chart" }).click();
    await expect(trends.locator("svg[role=img]")).toBeVisible();

    // The Moments tab's replay has WordSocket's own provider.
    await admin.visitAdminPage("admin.php", "page=wordsocket&tab=moments&moment=new");
    await expect(page.locator(".wpsignal-rule-replay")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".wpsignal-rule-replay")).toContainText("Projections");
  });

  test("a journey the browser never got to report is sent from the outbox once the visitor is back", async ({ browser, baseURL }) => {
    const visitor = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
    const shop = await visitor.newPage();
    const table = `${wp("db", "prefix")}wpsignal_journeys`;
    const journeyId = randomUUID();
    const hex = journeyId.replace(/-/g, "");
    const row = (column: string) => wp("db", "query", `SELECT ${column} FROM ${table} WHERE journey_id = UNHEX('${hex}')`, "--skip-column-names").trim();
    try {
      // A journey held 45 minutes ago, its tab hidden, that a crash kept from being reported.
      await shop.goto("/");
      await shop.evaluate(
        ([n, at]) => window.localStorage.setItem("wordsocket-outbox", JSON.stringify([{ n, j: "home:1:40>away:0:0", at }])),
        [journeyId, Date.now() - 45 * 60_000] as const,
      );
      await shop.reload();
      await waitForState(shop, { connected: true, transport: "ws" });
      // The flush: a leave ending in the gap's away, dated when the away reached it, 15 minutes ago.
      await expect.poll(() => row("outcome"), { timeout: 20_000 }).toBe("left");
      expect(row("journey")).toBe("h:1:40>w:0:1800");
      const ago = Number(row("TIMESTAMPDIFF(SECOND, last_seen, UTC_TIMESTAMP())"));
      expect(ago).toBeGreaterThan(14 * 60);
      expect(ago).toBeLessThan(17 * 60);
      await expect.poll(() => shop.evaluate(() => window.localStorage.getItem("wordsocket-outbox"))).toBeNull();
    } finally {
      await visitor.close();
      wp("db", "query", `DELETE FROM ${table} WHERE journey_id = UNHEX('${hex}')`);
    }
  });

  test("a journey an extension ended keeps its page, its hidden spell and a reload, and the next other page begins a new one", async ({ browser, baseURL }) => {
    const visitor = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
    const shop = await visitor.newPage();
    const table = `${wp("db", "prefix")}wpsignal_journeys`;
    const hex = (n: string) => n.replace(/-/g, "");
    const row = (n: string, column: string) => wp("db", "query", `SELECT ${column} FROM ${table} WHERE journey_id = UNHEX('${hex(n)}')`, "--skip-column-names").trim();
    const reports: { kind: string; n: string }[] = [];
    shop.on("request", (request) => {
      const url = request.url();
      if (!url.includes("/wpsignal/v1/visit") && !url.includes("/wpsignal/v1/leave")) return;
      reports.push({ kind: url.includes("/visit") ? "visit" : "leave", n: (JSON.parse(request.postData() ?? "{}") as { n: string }).n });
    });
    const held = () => shop.evaluate(() => JSON.parse(window.sessionStorage.getItem("wordsocket-journey") ?? "{}") as { n?: string; e?: string });

    // The first step writes its row; an extension then ends the journey (an order placed).
    await arrive(shop, "/");
    await expect.poll(() => reports.length).toBe(1);
    const first = reports[0].n;
    await expect.poll(() => row(first, "outcome"), { timeout: 15_000 }).toBe("open");
    wp("db", "query", `UPDATE ${table} SET outcome = 'converted' WHERE journey_id = UNHEX('${hex(first)}')`);

    // The tab goes hidden and comes back: the visit's answer says the journey ended, and it goes on under the same id.
    await setHidden(shop, true);
    await expect.poll(() => reports.length).toBe(2);
    await expect.poll(async () => (await held()).e).toBe("home:0");
    await shop.waitForTimeout(500);
    await setHidden(shop, false);
    await shop.waitForTimeout(500);
    expect((await held()).n).toBe(first);
    expect(reports, "a return within the gap writes nothing and starts nothing").toHaveLength(2);

    // A reload of the same page stays on the ended journey.
    await shop.reload();
    await waitForState(shop, { connected: true, transport: "ws" });
    await engage(shop);
    await shop.waitForTimeout(500);
    expect((await held()).n).toBe(first);
    expect(reports.filter((r) => r.kind === "visit")).toHaveLength(2);
    const leavesBefore = reports.filter((r) => r.kind === "leave" && r.n === first).length;

    // A link to another page: a new journey begins there, and the ended one gets its leave.
    await shop.locator("article a[href], .entry-title a, h2 a").first().click();
    await waitForState(shop, { connected: true, transport: "ws" });
    await engage(shop);
    await expect.poll(() => reports.filter((r) => r.kind === "leave" && r.n === first).length).toBe(leavesBefore + 1);
    await expect.poll(() => reports.filter((r) => r.kind === "visit" && r.n !== first).length).toBe(1);
    const second = reports.find((r) => r.kind === "visit" && r.n !== first)?.n ?? "";
    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    expect((await held()).n).toBe(second);
    await visitor.close();

    // The rows: the ended journey keeps its outcome with the hidden spell and the reload on it; the new one holds the post alone.
    await expect.poll(() => row(first, "journey"), { timeout: 15_000 }).toMatch(/^h:0:\d+>w:0:\d+>h:0:\d+>h:0:\d+$/);
    expect(row(first, "outcome")).toBe("converted");
    await expect.poll(() => row(second, "journey"), { timeout: 15_000 }).toMatch(/^p:\d+:\d+$/);
  });

  test("with History off the tab still draws what was kept under a notice, and the replay keeps its provider", async ({ admin, page }) => {
    wp("option", "update", "wpsignal_history_enabled", "0");
    try {
      await admin.visitAdminPage("admin.php", TAB);
      await expect(page.getByLabel("Keep a history of Journeys")).not.toBeChecked();
      await expect(page.getByText("History is off")).toBeVisible();
      await expect(page.locator(".wpsignal-visual")).toHaveCount(3, { timeout: 20_000 });
      await admin.visitAdminPage("admin.php", "page=wordsocket&tab=moments&moment=new");
      await expect(page.getByRole("heading", { name: "New Moment" })).toBeVisible();
      await expect(page.locator(".wpsignal-rule-replay")).toBeVisible({ timeout: 20_000 });
      // The switch turns it on: the notice goes without a reload.
      await admin.visitAdminPage("admin.php", TAB);
      await page.getByLabel("Keep a history of Journeys").check();
      await expect(page.locator(".components-snackbar")).toContainText("Settings saved.");
      await expect(page.getByText("History is off")).toHaveCount(0);
      await expect(page.locator(".wpsignal-visual")).toHaveCount(3);
      expect(wp("option", "get", "wpsignal_history_enabled")).toBe("1");
    } finally {
      wp("option", "update", "wpsignal_history_enabled", "1");
    }
  });

  test("the object cache notice stays closed once dismissed, through the user's meta", async ({ admin, page }) => {
    const user = wp("user", "get", process.env.WP_USERNAME!, "--field=ID");
    // wp-cli exits non-zero when there is no row to delete.
    const forget = () => {
      try {
        wp("user", "meta", "delete", user, "wpsignal_dismissed_notices");
      } catch {
        // nothing was kept
      }
    };
    forget();
    try {
      await admin.visitAdminPage("admin.php", TAB);
      await expect(page.getByText(/Database size:/)).toBeVisible({ timeout: 20_000 });
      const notice = page.getByText("Object Cache Missing");
      // The probe asks twice; a site with a persistent cache never shows the notice.
      const shown = await notice.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false);
      test.skip(!shown, "the E2E site has a persistent object cache, so there is nothing to dismiss");
      await notice.locator("xpath=ancestor::*[@role='alert' or @role='status' or contains(@class, 'notice')][1]").getByRole("button").first().click();
      await expect(notice).toHaveCount(0);
      expect(wp("user", "meta", "get", user, "wpsignal_dismissed_notices", "--format=json")).toContain("object-cache-missing");
      await page.reload();
      await expect(page.getByText(/Database size:/)).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1_500);
      await expect(notice).toHaveCount(0);
    } finally {
      forget();
    }
  });

  test("the retention slider saves once it rests, and the card says what the table takes", async ({ admin, page }) => {
    let months = "";
    try {
      months = wp("option", "get", "wpsignal_journeys_retention_months");
    } catch {
      months = "";
    }
    wp("option", "update", "wpsignal_journeys_retention_months", "3");
    try {
      await admin.visitAdminPage("admin.php", TAB);
      // With History on the card opens collapsed.
      await page.locator(".wpsignal-collapsible-card", { hasText: "Settings" }).getByRole("button").first().click();
      await expect(page.getByText(/Database size:/)).toBeVisible({ timeout: 20_000 });
      const slider = page.locator('input[type="range"]');
      await expect(slider).toHaveAttribute("max", "12");
      await expect(slider).toHaveValue("3");
      await slider.focus();
      await page.keyboard.press("End");
      await expect(slider).toHaveValue("12");
      await expect(page.locator(".components-snackbar")).toContainText("Settings saved.");
      expect(wp("option", "get", "wpsignal_journeys_retention_months")).toBe("12");
    } finally {
      if (months) wp("option", "update", "wpsignal_journeys_retention_months", months);
      else wp("option", "delete", "wpsignal_journeys_retention_months");
    }
  });
});
