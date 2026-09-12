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
 * Channels beyond the default `events`: a page subscribes to its own channel
 * and receives what the site publishes there, from PHP and from the REST
 * publish route, decrypted in the browser.
 */
test.describe("Channels", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForState(page, { connected: true, transport: "ws" });
    await page.evaluate(() => {
      window.__wpsEvents = [];
      for (const name of ["order.paid", "order.refunded"]) {
        document.addEventListener(`wpsignal:${name}`, (e) => {
          window.__wpsEvents.push((e as CustomEvent).detail);
        });
      }
      window.WPS!.subscribe(["shop"]);
    });
  });

  test("WPS::publish() from PHP reaches a subscriber of that channel", async ({ page }) => {
    wp("eval", 'WPSignal\\WPS::publish( "shop", "order.paid", array( "order_id" => 42 ) );');
    await expect.poll(() => page.evaluate(() => window.__wpsEvents.length), { timeout: 15_000 }).toBeGreaterThan(0);
    const [event] = await page.evaluate(() => window.__wpsEvents);
    expect(event.channel).toBe("shop");
    expect(event.data.order_id).toBe(42);
  });

  test("the REST publish route delivers to the same channel", async ({ page, requestUtils }) => {
    await requestUtils.rest({
      method: "POST",
      path: "/wpsignal/v1/publish",
      data: { channel: "shop", event: "order.refunded", data: { order_id: 43, amount: "9.99" } },
    });
    await expect.poll(() => page.evaluate(() => window.__wpsEvents.length), { timeout: 15_000 }).toBeGreaterThan(0);
    const [event] = await page.evaluate(() => window.__wpsEvents);
    expect(event.channel).toBe("shop");
    expect(event.data).toMatchObject({ order_id: 43, amount: "9.99" });
  });

  test("a channel the page did not subscribe to stays silent", async ({ page }) => {
    wp("eval", 'WPSignal\\WPS::publish( "warehouse", "order.paid", array( "order_id" => 44 ) );');
    // Give the relay ample time to deliver, then confirm nothing arrived.
    await page.waitForTimeout(2_000);
    expect(await page.evaluate(() => window.__wpsEvents.length)).toBe(0);
  });
});
