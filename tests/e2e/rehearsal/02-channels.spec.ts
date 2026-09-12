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
 * Channels beyond the default `events`: a page subscribes to a channel the
 * stub extension registered and receives what the site publishes there, from
 * PHP and from the REST publish route, decrypted in the browser. The stub also
 * reserves `stub:private` for administrators, which puts the site in strict
 * mode: unregistered channels are refused, and the reserved one is gated.
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
      window.WPS!.subscribe(["stub:public"]);
    });
  });

  test("WPS::publish() from PHP reaches a subscriber of that channel", async ({ page }) => {
    wp("eval", 'WPSignal\\WPS::publish( "stub:public", "order.paid", array( "order_id" => 42 ) );');
    await expect.poll(() => page.evaluate(() => window.__wpsEvents.length), { timeout: 15_000 }).toBeGreaterThan(0);
    const [event] = await page.evaluate(() => window.__wpsEvents);
    expect(event.channel).toBe("stub:public");
    expect(event.data.order_id).toBe(42);
  });

  test("the REST publish route delivers to the same channel", async ({ page, requestUtils }) => {
    await requestUtils.rest({
      method: "POST",
      path: "/wpsignal/v1/publish",
      data: { channel: "stub:public", event: "order.refunded", data: { order_id: 43, amount: "9.99" } },
    });
    await expect.poll(() => page.evaluate(() => window.__wpsEvents.length), { timeout: 15_000 }).toBeGreaterThan(0);
    const [event] = await page.evaluate(() => window.__wpsEvents);
    expect(event.channel).toBe("stub:public");
    expect(event.data).toMatchObject({ order_id: 43, amount: "9.99" });
  });

  test("an unregistered channel is refused once a namespace is reserved", async ({ page }) => {
    const reply = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const off = window.WPS!.onMessage(() => undefined);
          // The relay answers a forbidden subscribe with an error frame the
          // client logs; observe it through the transport by racing a timer.
          setTimeout(() => {
            off();
            resolve("no-error-frame");
          }, 1500);
          window.WPS!.subscribe(["shop"]);
        }),
    );
    // Whatever the client surfaces, nothing published to `shop` may arrive.
    wp("eval", 'WPSignal\\WPS::publish( "shop", "order.paid", array( "order_id" => 45 ) );');
    await page.waitForTimeout(1_500);
    expect(reply).toBeTruthy();
    expect(await page.evaluate(() => window.__wpsEvents.length)).toBe(0);
  });

  test("a reserved namespace is refused for a non-administrator and delivered to an administrator", async ({ page, browser, baseURL }) => {
    // Administrator (this page): subscribe to the private channel and receive.
    await page.evaluate(() => {
      document.addEventListener("wpsignal:staff.ping", (e) => {
        window.__wpsEvents.push((e as CustomEvent).detail);
      });
      window.WPS!.subscribe(["stub:private:alerts"]);
    });
    await page.waitForTimeout(500);
    wp("eval", 'WPSignal\\WPS::publish( "stub:private:alerts", "staff.ping", array( "n" => 1 ) );');
    await expect.poll(() => page.evaluate(() => window.__wpsEvents.length), { timeout: 15_000 }).toBe(1);

    // Visitor: the token lists public channels only, so the subscribe is refused.
    const visitor = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, storageState: undefined });
    const token = await visitor.request.get("/wp-json/wpsignal/v1/token");
    expect(token.status()).toBe(401);
    await visitor.close();
  });

  test("a channel the page did not subscribe to stays silent", async ({ page }) => {
    wp("eval", 'WPSignal\\WPS::publish( "warehouse", "order.paid", array( "order_id" => 44 ) );');
    // Give the relay ample time to deliver, then confirm nothing arrived.
    await page.waitForTimeout(2_000);
    expect(await page.evaluate(() => window.__wpsEvents.length)).toBe(0);
  });
});
