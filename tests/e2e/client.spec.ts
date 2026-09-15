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

  test("falls back to SSE when WebSocket is disabled, and events still arrive with their channel", async ({ page, requestUtils }) => {
    /*
     * wpSignalConfig is localized by PHP before the client script runs; trap
     * the assignment and flip forceSSE before the client reads it.
     */
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

    // Events arrive over the stream with their channel, exactly as over the socket.
    await page.evaluate(() => {
      window.__wpsEvents = [];
      document.addEventListener("wpsignal:post.updated", (e) => {
        window.__wpsEvents.push((e as CustomEvent).detail);
      });
    });
    const post = await requestUtils.createPost({ title: "E2E SSE post", status: "publish", date_gmt: new Date().toISOString() });
    try {
      await expect.poll(() => page.evaluate(() => window.__wpsEvents.length), { timeout: 15_000 }).toBeGreaterThan(0);
      const ours = (await page.evaluate(() => window.__wpsEvents)).find((e) => Number(e.data.post_id) === post.id);
      expect(ours?.data.post_title).toBe("E2E SSE post");
      expect(ours?.channel).toBe("events");
    } finally {
      await requestUtils.rest({ method: "DELETE", path: `/wp/v2/posts/${post.id}`, params: { force: true } });
    }
  });

  test("returns to WebSocket the moment the fallback stream opens, when the socket was only down briefly", async ({ page }) => {
    /*
     * The first socket attempt fails (the relay was down); the stream then opens,
     * which proves the relay is back, and the client's probe finds the socket open.
     */
    await page.addInitScript(() => {
      const RealWebSocket = window.WebSocket;
      const counter = window as unknown as { __wsAttempts: number };
      counter.__wsAttempts = 0;
      function OnceRefusing(this: EventTarget, url: string) {
        counter.__wsAttempts += 1;
        if (counter.__wsAttempts > 1) return new RealWebSocket(url);
        const fake = new EventTarget() as EventTarget & { readyState: number; binaryType: string; send(): void; close(): void };
        fake.readyState = 0;
        fake.binaryType = "blob";
        fake.send = () => {};
        fake.close = () => {
          fake.readyState = 3;
        };
        setTimeout(() => {
          fake.readyState = 3;
          fake.dispatchEvent(new Event("error"));
          fake.dispatchEvent(new CloseEvent("close", { code: 1006, wasClean: false }));
        }, 0);
        return fake;
      }
      Object.assign(OnceRefusing, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
      (window as unknown as { WebSocket: unknown }).WebSocket = OnceRefusing;
    });
    await page.goto("/");
    await waitForConnection(page, "ws");
    const state = await page.evaluate(() => window.WPS!.state);
    expect(state.error).toBeUndefined();
    // The refused attempt sent the client to the stream; the probe was the second attempt.
    expect(await page.evaluate(() => (window as unknown as { __wsAttempts: number }).__wsAttempts)).toBe(2);
  });

  test("returns to WebSocket at the next token refresh when the socket stays blocked", async ({ page }) => {
    /*
     * A WebSocket that never opens, as during a relay restart: the client falls
     * back to SSE. Restoring the real WebSocket stands in for the relay returning;
     * the recovery step is the token refresh, so the first token is given a short
     * life to bring it forward.
     */
    await page.addInitScript(() => {
      let stored: Record<string, unknown> | undefined;
      Object.defineProperty(window, "wpSignalConfig", {
        configurable: true,
        get: () => stored,
        set: (value: Record<string, unknown>) => {
          stored = { ...value, exp: Math.floor(Date.now() / 1000) + 15 };
        },
      });
      const RealWebSocket = window.WebSocket;
      class RefusingWebSocket extends EventTarget {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        static readonly CLOSED = 3;
        readyState = 0;
        binaryType = "blob";
        constructor(public url: string) {
          super();
          setTimeout(() => {
            this.readyState = 3;
            this.dispatchEvent(new Event("error"));
            this.dispatchEvent(new CloseEvent("close", { code: 1006, wasClean: false }));
          }, 0);
        }
        send(): void {}
        close(): void {
          this.readyState = 3;
        }
      }
      (window as unknown as { WebSocket: unknown }).WebSocket = RefusingWebSocket;
      (window as unknown as { __restoreWebSocket: () => void }).__restoreWebSocket = () => {
        window.WebSocket = RealWebSocket;
      };
    });
    await page.goto("/");
    await waitForConnection(page, "sse");

    await page.evaluate(() => (window as unknown as { __restoreWebSocket: () => void }).__restoreWebSocket());
    // The refresh fires at 80% of the 15s token life and reconnects, WebSocket first.
    await waitForConnection(page, "ws");
    const state = await page.evaluate(() => window.WPS!.state);
    expect(state.error).toBeUndefined();
  });

  test("anonymous visitors get no token unless the site opts in", async ({ browser, baseURL }) => {
    /*
     * Default gate: logged-in users only. A site opens the route to visitors
     * with `add_filter( 'wpsignal_allow_client', '__return_true' )`, which the
     * PHPUnit suite covers.
     */
    const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, storageState: undefined });
    const response = await context.request.get("/wp-json/wpsignal/v1/token");
    expect(response.status()).toBe(401);
    await context.close();
  });
});
