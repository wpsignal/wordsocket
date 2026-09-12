import "./env";
import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __wpsEvents: Array<{ channel: string; data: Record<string, unknown> }>;
  }
}

async function waitForConnection(page: Page, transport: "ws" | "sse") {
  await expect
    .poll(() => page.evaluate(() => (window.WPS ? { ...window.WPS.state } : null)), { timeout: 20_000 })
    .toMatchObject({ connected: true, transport });
}

test.describe("Realtime client", () => {
  test("connects over WebSocket for a logged-in visitor", async ({ page }) => {
    await page.goto("/");
    await waitForConnection(page, "ws");
    const state = await page.evaluate(() => window.WPS!.state);
    expect(state.failures).toBe(0);
    expect(state.error).toBeUndefined();
  });

  test("a published post arrives as a wpsignal:post.updated DOM event", async ({ page, requestUtils }) => {
    await page.goto("/");
    await waitForConnection(page, "ws");
    await page.evaluate(() => {
      window.__wpsEvents = [];
      document.addEventListener("wpsignal:post.updated", (e) => {
        window.__wpsEvents.push((e as CustomEvent).detail);
      });
    });

    const post = await requestUtils.createPost({
      title: "E2E post",
      status: "publish",
      date_gmt: new Date().toISOString(),
    });
    try {
      await expect.poll(() => page.evaluate(() => window.__wpsEvents.length), { timeout: 15_000 }).toBeGreaterThan(0);
      const events = await page.evaluate(() => window.__wpsEvents);
      const ours = events.find((e) => Number(e.data.post_id) === post.id);
      expect(ours, `event for post ${post.id} in ${JSON.stringify(events)}`).toBeTruthy();
      expect(ours?.data.post_title).toBe("E2E post");
      expect(ours?.channel).toBe("events");
    } finally {
      await requestUtils.rest({ method: "DELETE", path: `/wp/v2/posts/${post.id}`, params: { force: true } });
    }
  });

  test("falls back to SSE when WebSocket is disabled", async ({ page }) => {
    // wpSignalConfig is localized by PHP before the client script runs; trap
    // the assignment and flip forceSSE before the client reads it.
    await page.addInitScript(() => {
      let stored: Record<string, unknown> | undefined;
      Object.defineProperty(window, "wpSignalConfig", {
        configurable: true,
        get: () => stored,
        set: (value: Record<string, unknown>) => {
          stored = { ...value, forceSSE: true };
        },
      });
    });
    await page.goto("/");
    await waitForConnection(page, "sse");
  });

  test("anonymous visitors get no token unless the site opts in", async ({ browser, baseURL }) => {
    // Default gate: logged-in users only. A site opens the route to visitors
    // with `add_filter( 'wpsignal_allow_client', '__return_true' )`, which the
    // PHPUnit suite covers.
    const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, storageState: undefined });
    const response = await context.request.get("/wp-json/wpsignal/v1/token");
    expect(response.status()).toBe(401);
    await context.close();
  });
});
