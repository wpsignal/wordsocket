import "../env";
import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { wp } from "../env";
import { waitForState } from "./helpers";

declare global {
  interface Window {
    __wpsEvents: Array<{ channel: string; data: Record<string, unknown> }>;
  }
}

/**
 * A custom trigger built in the Triggers tab fires end to end: option change
 * in WordPress, publish to the relay, DOM event in a visitor's browser.
 */
test.describe("Custom triggers", () => {
  const originalName = wp("option", "get", "blogname");

  test.afterEach(async () => {
    wp("option", "update", "blogname", originalName);
    wp("option", "delete", "wpsignal_custom_triggers");
  });

  test("an option trigger created in the UI publishes when the option changes", async ({ admin, page, context }) => {
    await admin.visitAdminPage("admin.php", "page=wordsocket");
    await page.getByRole("tab", { name: "Triggers" }).click();
    await page.getByRole("button", { name: "Add Trigger" }).click();

    const row = page.locator(".wpsignal-trigger-row").last();
    await row.getByLabel("Type", { exact: true }).selectOption("option");
    await row.getByLabel("Option Name").selectOption("blogname");
    await row.getByLabel("Channel").fill("events");
    await row.getByLabel("Event").fill("site.renamed");
    await page.getByRole("button", { name: "Save Triggers" }).click();
    await expect(page.getByText("Saved", { exact: false }).first()).toBeVisible();

    // A visitor tab listening for the event.
    const visitor = await context.newPage();
    await visitor.goto("/");
    await waitForState(visitor, { connected: true });
    await visitor.evaluate(() => {
      window.__wpsEvents = [];
      document.addEventListener("wpsignal:site.renamed", (e) => {
        window.__wpsEvents.push((e as CustomEvent).detail);
      });
    });

    wp("option", "update", "blogname", `E2E ${Date.now()}`);

    await expect.poll(() => visitor.evaluate(() => window.__wpsEvents.length), { timeout: 15_000 }).toBeGreaterThan(0);
    const [event] = await visitor.evaluate(() => window.__wpsEvents);
    expect(event.channel).toBe("events");
    expect(String(event.data.option)).toBe("blogname");
    await visitor.close();
  });
});
