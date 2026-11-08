import "./env";
import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import type { Page } from "@playwright/test";
import { wp } from "./env";

declare global {
  interface Window {
    __wpsEvents: Array<{ channel: string; data: Record<string, unknown> }>;
  }
}

/*
 * The client assigns `window.wpSignalConfig` from the page's JSON block before it starts; trap that
 * assignment and hand the client an adjusted config.
 */
async function trapConfig(page: Page, adjust: (value: Record<string, unknown>) => Record<string, unknown>) {
  await page.addInitScript((source: string) => {
    const change = new Function("value", `return (${source})(value);`) as (
      value: Record<string, unknown>,
    ) => Record<string, unknown>;
    let stored: Record<string, unknown> | undefined;
    Object.defineProperty(window, "wpSignalConfig", {
      configurable: true,
      get: () => stored,
      set: (value: Record<string, unknown>) => {
        stored = change(value);
      },
    });
  }, adjust.toString());
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

  test("offers ids and a channel check to extensions", async ({ page, browser, baseURL }) => {
    await page.goto("/");
    await waitForConnection(page, "ws");
    const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    const ids = await page.evaluate(() => [window.WPS!.uuid(), window.WPS!.uuid()]);
    expect(ids[0]).toMatch(V4);
    expect(ids[1]).toMatch(V4);
    expect(ids[0]).not.toBe(ids[1]);

    // The visitor id is kept for the browser: the same after a reload, in storage under WordSocket's key.
    const visitor = await page.evaluate(() => window.WPS!.visitorId());
    expect(visitor).toMatch(V4);
    await page.reload();
    await waitForConnection(page, "ws");
    expect(await page.evaluate(() => window.WPS!.visitorId())).toBe(visitor);
    expect(await page.evaluate(() => window.localStorage.getItem("wordsocket-visitor"))).toBe(visitor);

    // Another browser is another visitor (same login, its own storage once the copied id is dropped).
    const other = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, storageState: await page.context().storageState() });
    try {
      const otherPage = await other.newPage();
      await otherPage.goto("/");
      await otherPage.evaluate(() => window.localStorage.removeItem("wordsocket-visitor"));
      await otherPage.reload();
      await waitForConnection(otherPage, "ws");
      expect(await otherPage.evaluate(() => window.WPS!.visitorId())).not.toBe(visitor);
    } finally {
      await other.close();
    }

    // An event counts only on the channel it is expected on, bare or qualified.
    const checks = await page.evaluate(() => [
      window.WPS!.onChannel("woo:stock", "woo:stock"),
      window.WPS!.onChannel("site:abc123:woo:stock", "woo:stock"),
      window.WPS!.onChannel("site:abc123:woo:activity", "woo:stock"),
      window.WPS!.onChannel("site:abc123:notwoo:stock", "woo:stock"),
    ]);
    expect(checks).toEqual([true, true, false, false]);

    // The public config: the plugin version, the debug flag, the site's name and this page's step, frozen.
    const config = await page.evaluate(() => ({
      ...window.WPS!.config,
      frozen: Object.isFrozen(window.WPS!.config) && Object.isFrozen(window.WPS!.config.page),
      debug: typeof window.WPS!.debug,
      printed: (window.WPS as unknown as { printed?: unknown }).printed === undefined,
    }));
    expect(config.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof config.isDebug).toBe("boolean");
    expect(config.siteName).not.toBe("");
    expect(config.page.kind).toBe("home");
    expect(config.frozen).toBe(true);
    expect(config.debug).toBe("function");
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
    await trapConfig(page, (value) => ({ ...value, forceSSE: true }));
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
    await trapConfig(page, (value) => ({ ...value, exp: Math.floor(Date.now() / 1000) + 15 }));
    await page.addInitScript(() => {
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

  test("renews a stale nonce through admin-ajax and connects with the visitor's own grants", async ({ page }) => {
    /*
     * A page served from a cache carries a nonce that is not this visitor's, and no token worth
     * using. Core refuses the nonce with 403 rest_cookie_invalid_nonce; the client asks admin-ajax
     * for a fresh one and tries again.
     */
    await trapConfig(page, ({ token: _token, ...rest }) => ({ ...rest, nonce: "0123456789" }));
    const renewals: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("admin-ajax.php") && req.url().includes("action=rest-nonce")) renewals.push(req.url());
    });
    const tokenRequests: number[] = [];
    page.on("response", (res) => {
      if (res.url().includes("/wpsignal/v1/token")) tokenRequests.push(res.status());
    });
    await page.goto("/");
    await waitForConnection(page, "ws");
    expect(tokenRequests).toEqual([403, 200]);
    expect(renewals).toHaveLength(1);
    const state = await page.evaluate(() => window.WPS!.state);
    expect(state.failures).toBe(0);
    // The retry ran as the visitor, not as a guest: only a guest token is kept for the next page.
    expect(await page.evaluate(() => window.sessionStorage.getItem("wordsocket-token"))).toBeNull();

    // The next page prints the same refused nonce; the tab holds the renewed one and is not refused again.
    await page.goto("/?p=1");
    await waitForConnection(page, "ws");
    expect(tokenRequests).toEqual([403, 200, 200]);
    expect(renewals).toHaveLength(1);
  });

  test("a prompt enters and leaves with the motion its style says", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const styles = (motion: string) => JSON.stringify({ all: {}, modal: {}, banner: { motion }, bar: {}, toast: {}, panel: {} });
    const sample = async (motion: string) => {
      wp("option", "update", "wpsignal_prompt_style", styles(motion), "--format=json");
      await page.goto("/");
      await page.waitForFunction(() => !!window.WPS);
      return page.evaluate(async () => {
        window.WPS!.recovery.preview("banner");
        const el = document.querySelector(".wordsocket-prompt--banner") as HTMLElement;
        await new Promise((r) => setTimeout(r, 60));
        const cs = getComputedStyle(el);
        const early = { opacity: Number(cs.opacity), moved: cs.transform !== "none" && cs.transform !== "matrix(1, 0, 0, 1, 0, 0)" };
        window.WPS!.recovery.close();
        const lingers = !!document.querySelector(".wordsocket-prompt--banner");
        await new Promise((r) => setTimeout(r, 400));
        return { ...early, lingers, gone: !document.querySelector(".wordsocket-prompt--banner") };
      });
    };
    try {
      const slide = await sample("slide");
      expect(slide.opacity).toBeLessThan(1);
      expect(slide.moved).toBe(true);
      expect(slide).toMatchObject({ lingers: true, gone: true });
      const fade = await sample("fade");
      expect(fade.opacity).toBeLessThan(1);
      expect(fade.moved).toBe(false);
      const none = await sample("none");
      expect(none).toMatchObject({ opacity: 1, moved: false, lingers: false, gone: true });
    } finally {
      wp("option", "delete", "wpsignal_prompt_style");
    }
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
