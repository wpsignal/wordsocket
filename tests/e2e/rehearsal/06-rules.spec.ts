import "../env";
import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import type { Page } from "@playwright/test";
import { wp } from "../env";
import { waitForState } from "./helpers";

/*
 * The rules engine (0.31) end to end: a rule saved through REST reaches the
 * browser, evaluates edge triggered, fires WordSocket's actions and the
 * stub extension's, and reports the firing. The administrator's own session
 * is the visitor, since a bare site mints tokens for logged-in users only.
 */

const RULES = "/wpsignal/v1/rules";

type RuleJson = Record<string, unknown>;

function rule(overrides: RuleJson = {}): RuleJson {
  return {
    id: "e2e-post-dwell",
    name: "A reader who lingers on a post",
    enabled: true,
    frequency: "visitor",
    conditions: {
      all: [
        { condition: "page_kind", op: "is", value: "post" },
        { condition: "dwell", op: "at_least", value: 1 },
      ],
    },
    actions: [
      {
        action: "show",
        presentation: {
          type: "modal",
          pattern: 0,
          text: "Still reading, {site.name}?",
        },
      },
    ],
    ...overrides,
  };
}

async function arrive(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForState(page, { connected: true, transport: "ws" });
}

/** A fresh visitor: same login, no rules memory, a new tab's journey. */
async function forget(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.localStorage.removeItem("wordsocket-rules");
    window.sessionStorage.removeItem("wordsocket-rules-state");
    window.sessionStorage.removeItem("wordsocket-rules-visit");
    window.sessionStorage.removeItem("wordsocket-journey");
    Object.keys(window.sessionStorage)
      .filter((k) => k.startsWith("wordsocket-prompt-"))
      .forEach((k) => window.sessionStorage.removeItem(k));
  });
}

function setHidden(page: Page, hidden: boolean): Promise<void> {
  return page.evaluate((isHidden) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => isHidden,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (isHidden ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test.describe("Rules", () => {
  let postUrl = "";

  test.beforeAll(async ({ requestUtils }) => {
    const post = (await requestUtils.rest({
      method: "POST",
      path: "/wp/v2/posts",
      data: {
        title: "E2E rules post",
        status: "publish",
        content: "<p>Read me</p>",
      },
    })) as { link: string };
    postUrl = post.link;
  });

  test.beforeEach(async ({ page }) => {
    await arrive(page, "/");
    await forget(page);
  });

  test.afterEach(async () => {
    wp("option", "delete", "wpsignal_rules");
    wp("transient", "delete", "stub_rule_fired");
  });

  test("a rule fires on the transition into its conditions, once per visitor", async ({
    page,
    browser,
    baseURL,
    requestUtils,
  }) => {
    await requestUtils.rest({
      method: "POST",
      path: RULES,
      data: { rules: [rule()] },
    });

    // Home: the rule is seeded and false. The post: true after a second of dwell.
    await arrive(page, "/");
    await forget(page);
    expect(
      await page.evaluate(() => window.WPS!.rules.current.rules.length),
    ).toBe(1);
    await expect(page.locator(".wordsocket-prompt")).toHaveCount(0);
    await arrive(page, postUrl);
    const modal = page.locator("dialog.wordsocket-prompt--modal[open]");
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(modal).toContainText("Still reading,");
    await page.keyboard.press("Escape");

    // Once per visitor: a reload shows nothing, and so does another post visit.
    await page.reload();
    await waitForState(page, { connected: true, transport: "ws" });
    await page.waitForTimeout(3_000);
    await expect(page.locator(".wordsocket-prompt")).toHaveCount(0);
    // The once flag is keyed `id:rev`, so an edit re-arms it.
    expect(
      await page.evaluate(() =>
        Object.keys(
          JSON.parse(window.localStorage.getItem("wordsocket-rules") ?? "{}")
            .once ?? {},
        ),
      ),
    ).toEqual(["e2e-post-dwell:1"]);

    // A visitor with no memory fires again.
    const other = await browser.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: await page.context().storageState(),
    });
    try {
      const fresh = await other.newPage();
      await arrive(fresh, "/");
      await forget(fresh);
      await arrive(fresh, postUrl);
      await expect(
        fresh.locator("dialog.wordsocket-prompt--modal[open]"),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await other.close();
    }
  });

  test("a rule saved mid-session arrives by broadcast and fires only on the next transition", async ({
    page,
    requestUtils,
  }) => {
    await arrive(page, postUrl);
    await forget(page);
    await page.waitForTimeout(1_500); // the dwell condition is already true here
    const before = await page.evaluate(() => window.WPS!.rules.current.version);

    await requestUtils.rest({
      method: "POST",
      path: RULES,
      data: { rules: [rule()] },
    });
    await expect
      .poll(() => page.evaluate(() => window.WPS!.rules.current.version), {
        timeout: 15_000,
      })
      .toBeGreaterThan(before);
    expect(
      await page.evaluate(() => window.WPS!.rules.current.rules.length),
    ).toBe(1);
    // Edge triggered: already true when it arrived, so it only recorded.
    await page.waitForTimeout(3_000);
    await expect(page.locator(".wordsocket-prompt")).toHaveCount(0);

    // Leave and come back: false, then true again, so it fires.
    await arrive(page, "/");
    await arrive(page, postUrl);
    await expect(
      page.locator("dialog.wordsocket-prompt--modal[open]"),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Show with Grab their attention follows a hidden tab and is re-armed by an edit", async ({
    page,
    requestUtils,
  }) => {
    const original = await page.title();
    const grab = (text: string) =>
      rule({
        id: "e2e-grab",
        frequency: "visitor",
        conditions: {
          all: [{ condition: "time_hidden", op: "at_least", value: 1 }],
        },
        actions: [
          {
            action: "show",
            presentation: { type: "banner", pattern: 0, text },
          },
        ],
        attention: { enabled: true, title: "Your cart misses you" },
      });
    await requestUtils.rest({
      method: "POST",
      path: RULES,
      data: { rules: [grab("Welcome back")] },
    });
    await arrive(page, "/");
    await forget(page);
    await page.waitForTimeout(500);

    // Hidden: the banner opens into the tab and the title flashes. Back: the title is restored.
    await setHidden(page, true);
    await expect
      .poll(() => page.title(), { timeout: 5_000 })
      .toBe("Your cart misses you");
    await expect(page.locator(".wordsocket-prompt--banner")).toHaveCount(1);
    await setHidden(page, false);
    await expect(page.locator(".wordsocket-prompt--banner")).toBeVisible();
    await expect(page.locator(".wordsocket-prompt--banner")).toContainText(
      "Welcome back",
    );
    await expect.poll(() => page.title()).toBe(original);

    // Once per visitor: hiding again does nothing.
    await page
      .locator(".wordsocket-prompt--banner .wordsocket-prompt__close")
      .click();
    await setHidden(page, true);
    await page.waitForTimeout(1_000);
    expect(await page.title()).toBe(original);
    await setHidden(page, false);

    // An edit bumps the revision, which re-arms the once flag: the next hide fires again.
    await requestUtils.rest({
      method: "POST",
      path: RULES,
      data: { rules: [grab("Still here for you")] },
    });
    await expect
      .poll(
        () => page.evaluate(() => window.WPS!.rules.current.rules[0]?.rev),
        { timeout: 15_000 },
      )
      .toBe(2);
    await page.waitForTimeout(300);
    await setHidden(page, true);
    await expect
      .poll(() => page.title(), { timeout: 5_000 })
      .toBe("Your cart misses you");
    await setHidden(page, false);
    await expect(page.locator(".wordsocket-prompt--banner")).toContainText(
      "Still here for you",
    );
  });

  test("two rules on the same hide: both Shows open at once, the flashing one flashes until the return", async ({
    page,
    requestUtils,
  }) => {
    const original = await page.title();
    const hidden = {
      all: [{ condition: "time_hidden", op: "at_least", value: 1 }],
    };
    await requestUtils.rest({
      method: "POST",
      path: RULES,
      data: {
        rules: [
          rule({
            id: "e2e-grab-two",
            frequency: "visitor",
            conditions: hidden,
            actions: [
              {
                action: "show",
                presentation: { type: "banner", pattern: 0, text: "Grabbed" },
              },
            ],
            attention: { enabled: true, title: "Come back" },
          }),
          rule({
            id: "e2e-plain-two",
            frequency: "always",
            conditions: hidden,
            actions: [
              {
                action: "show",
                presentation: { type: "bar", pattern: 0, text: "Plain" },
              },
            ],
          }),
        ],
      },
    });
    await arrive(page, "/");
    await forget(page);
    await page.waitForTimeout(500);
    await setHidden(page, true);
    await expect.poll(() => page.title(), { timeout: 5_000 }).toBe("Come back");
    // Both prompts are already open; only the moment with the switch on flashes.
    await expect(page.locator(".wordsocket-prompt")).toHaveCount(2);
    await setHidden(page, false);
    await expect.poll(() => page.title()).toBe(original);
    await expect(page.locator(".wordsocket-prompt--banner")).toContainText(
      "Grabbed",
    );
    await expect(page.locator(".wordsocket-prompt--bar")).toBeVisible();
  });

  test("shown every time, a moment that fires again replaces its prompts, and a dismissed prompt returns on the next transition", async ({
    page,
    requestUtils,
  }) => {
    await requestUtils.rest({
      method: "POST",
      path: RULES,
      data: {
        rules: [
          rule({
            id: "e2e-again",
            frequency: "always",
            conditions: {
              all: [{ condition: "time_hidden", op: "at_least", value: 1 }],
            },
            actions: [
              {
                action: "show",
                presentation: { type: "banner", pattern: 0, text: "One" },
              },
              {
                action: "show",
                presentation: { type: "bar", pattern: 0, text: "Two" },
              },
            ],
          }),
        ],
      },
    });
    await arrive(page, "/");
    await forget(page);
    await page.waitForTimeout(500);
    const banner = page.locator(".wordsocket-prompt--banner");
    const bar = page.locator(".wordsocket-prompt--bar");
    await setHidden(page, true);
    await expect(banner).toContainText("One", { timeout: 5_000 });
    await expect(bar).toContainText("Two");
    // Back to visible resets the edge; the next hide fires again, and the new prompts take the
    // place of the ones still open rather than stacking on them.
    await setHidden(page, false);
    await page.waitForTimeout(300);
    await setHidden(page, true);
    await page.waitForTimeout(2_500);
    await expect(page.locator(".wordsocket-prompt")).toHaveCount(2);
    await expect(banner).toContainText("One");
    await banner.locator(".wordsocket-prompt__close").click();
    await bar.locator(".wordsocket-prompt__close").click();
    await expect(page.locator(".wordsocket-prompt")).toHaveCount(0);
    // A dismissed prompt is not remembered: the next transition shows it again.
    await setHidden(page, false);
    await page.waitForTimeout(300);
    await setHidden(page, true);
    await expect(banner).toContainText("One", { timeout: 5_000 });
    await expect(bar).toContainText("Two");
  });

  test("per page view shows once on the page and again after a reload", async ({
    page,
    requestUtils,
  }) => {
    await requestUtils.rest({
      method: "POST",
      path: RULES,
      data: {
        rules: [
          rule({
            id: "e2e-page",
            frequency: "page",
            conditions: {
              all: [{ condition: "time_hidden", op: "at_least", value: 1 }],
            },
            actions: [
              {
                action: "show",
                presentation: { type: "banner", pattern: 0, text: "Page" },
              },
            ],
          }),
        ],
      },
    });
    await arrive(page, "/");
    await forget(page);
    await page.waitForTimeout(500);
    const banner = page.locator(".wordsocket-prompt--banner");
    await setHidden(page, true);
    await expect(banner).toContainText("Page", { timeout: 5_000 });
    await banner.locator(".wordsocket-prompt__close").click();
    // A second transition on the same page view shows nothing more.
    await setHidden(page, false);
    await page.waitForTimeout(300);
    await setHidden(page, true);
    await page.waitForTimeout(2_500);
    await expect(page.locator(".wordsocket-prompt")).toHaveCount(0);
    // A reload is a new page view.
    await arrive(page, "/");
    await page.waitForTimeout(500);
    await setHidden(page, true);
    await expect(banner).toContainText("Page", { timeout: 5_000 });
  });

  test("once per visit shows once in the journey and again in a new one", async ({
    page,
    requestUtils,
  }) => {
    await requestUtils.rest({
      method: "POST",
      path: RULES,
      data: {
        rules: [
          rule({
            id: "e2e-visit",
            frequency: "visit",
            conditions: {
              all: [{ condition: "time_hidden", op: "at_least", value: 1 }],
            },
            actions: [
              {
                action: "show",
                presentation: { type: "banner", pattern: 0, text: "Visit" },
              },
            ],
          }),
        ],
      },
    });
    await arrive(page, "/");
    await forget(page);
    await page.waitForTimeout(500);
    const banner = page.locator(".wordsocket-prompt--banner");
    await setHidden(page, true);
    await expect(banner).toContainText("Visit", { timeout: 5_000 });
    await banner.locator(".wordsocket-prompt__close").click();
    // The flag is in the tab's storage under the journey: a second transition shows nothing, and
    // neither does a reload (same tab, same journey).
    await setHidden(page, false);
    await page.waitForTimeout(300);
    await setHidden(page, true);
    await page.waitForTimeout(2_500);
    await expect(banner).toHaveCount(0);
    await page.reload();
    await waitForState(page, { connected: true, transport: "ws" });
    await setHidden(page, true);
    await page.waitForTimeout(2_500);
    await expect(banner).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        Object.keys(
          JSON.parse(
            window.sessionStorage.getItem("wordsocket-rules-visit") ?? "{}",
          ).keys ?? {},
        ),
      ),
    ).toEqual(["e2e-visit:1"]);
    // The visit ended (last arrival over 30 minutes ago): the next page opens a new journey, a
    // new visit, and the moment shows again.
    await page.evaluate(() => {
      const stored = JSON.parse(
        window.sessionStorage.getItem("wordsocket-journey") ?? "{}",
      ) as { at?: number };
      stored.at = Date.now() - 31 * 60_000;
      window.sessionStorage.setItem(
        "wordsocket-journey",
        JSON.stringify(stored),
      );
    });
    await page.reload();
    await waitForState(page, { connected: true, transport: "ws" });
    await setHidden(page, true);
    await expect(banner).toContainText("Visit", { timeout: 5_000 });
  });

  test("a moment that is switched off is taken back: its prompt and its flash go, its once flag stays for a resume", async ({
    page,
    requestUtils,
  }) => {
    const original = await page.title();
    const post = async (enabled: boolean) =>
      requestUtils.rest({
        method: "POST",
        path: RULES,
        data: {
          rules: [
            rule({
              id: "e2e-shown",
              enabled,
              frequency: "visitor",
              conditions: {
                all: [{ condition: "time_hidden", op: "at_least", value: 1 }],
              },
              actions: [
                {
                  action: "show",
                  presentation: { type: "banner", pattern: 0, text: "Shown" },
                },
              ],
            }),
            rule({
              id: "e2e-waiting",
              enabled,
              frequency: "always",
              conditions: {
                all: [{ condition: "time_hidden", op: "at_least", value: 1 }],
              },
              attention: { enabled: true, title: "Come back" },
            }),
          ],
        },
      });
    await post(true);
    await arrive(page, "/");
    await forget(page);
    expect(
      await page.evaluate(() => window.wpSignalConfig?.rules?.liveUrl ?? ""),
    ).toMatch(/\/wpsignal\/v1\/rules\/live$/);
    await page.waitForTimeout(500);
    await setHidden(page, true);
    const banner = page.locator(".wordsocket-prompt--banner");
    const onceKeys = () =>
      page.evaluate(() =>
        Object.keys(
          JSON.parse(window.localStorage.getItem("wordsocket-rules") ?? "{}")
            .once ?? {},
        ),
      );
    // Both fire at one second hidden: the prompts open into the tab and the flashing one flashes.
    await expect.poll(() => page.title(), { timeout: 5_000 }).toBe("Come back");
    await expect(banner).toContainText("Shown");
    expect(await onceKeys()).toEqual(["e2e-shown:1"]);

    // Both switched off: the prompts close and the flash stops. The once flag stays, since a
    // switched-off moment may be switched on again and must not show a once-only moment twice.
    await post(false);
    await expect(page.locator(".wordsocket-prompt")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect.poll(() => page.title(), { timeout: 10_000 }).toBe(original);
    expect(await onceKeys()).toEqual(["e2e-shown:1"]);
    expect(
      await page.evaluate(() => window.WPS!.rules.current.rules.length),
    ).toBe(0);
    await setHidden(page, false);
    await page.waitForTimeout(500);
    await expect(banner).toHaveCount(0);
  });

  test("an action's delay counts from the firing, is called off when the moment turns false, and runs when it holds", async ({
    page,
    requestUtils,
  }) => {
    await requestUtils.rest({
      method: "POST",
      path: RULES,
      data: {
        rules: [
          rule({
            id: "e2e-after",
            frequency: "always",
            conditions: {
              all: [{ condition: "stub_flag", op: "is", value: true }],
            },
            actions: [
              {
                action: "show",
                after: 3,
                presentation: { type: "banner", pattern: 0, text: "Later" },
              },
            ],
          }),
        ],
      },
    });
    await arrive(page, "/");
    await forget(page);
    await page.waitForTimeout(500);
    const banner = page.locator(".wordsocket-prompt--banner");
    const flag = (on: boolean) =>
      page.evaluate((value) => {
        window.__stubFlag = value;
        window.__stubTouch();
      }, on);
    // True, then false again before the three-second wait is up: nothing shows.
    await flag(true);
    await page.waitForTimeout(1_500);
    await expect(banner).toHaveCount(0);
    await flag(false);
    await page.waitForTimeout(3_000);
    await expect(banner).toHaveCount(0);
    // True and left alone: the banner arrives about three seconds after the firing.
    await flag(true);
    await page.waitForTimeout(2_000);
    await expect(banner).toHaveCount(0);
    await expect(banner).toContainText("Later", { timeout: 4_000 });
  });

  test("fired on a hidden tab, every action runs at once and a prompt opening while hidden starts the flash", async ({
    page,
    requestUtils,
  }) => {
    const original = await page.title();
    await requestUtils.rest({
      method: "POST",
      path: RULES,
      data: {
        rules: [
          rule({
            id: "e2e-split",
            frequency: "visitor",
            conditions: {
              all: [{ condition: "time_hidden", op: "at_least", value: 1 }],
            },
            actions: [
              { action: "stub_log", message: "they left" },
              {
                action: "show",
                presentation: {
                  type: "banner",
                  pattern: 0,
                  text: "Back with us",
                },
              },
            ],
            attention: { enabled: true, title: "Come back" },
          }),
        ],
      },
    });
    await arrive(page, "/");
    await forget(page);
    await page.waitForTimeout(500);
    await setHidden(page, true);
    // The stub has run and the banner is open while the tab is hidden; the banner started the flash.
    await expect
      .poll(() => page.evaluate(() => window.__stubFired.length), {
        timeout: 5_000,
      })
      .toBe(1);
    await expect.poll(() => page.title()).toBe("Come back");
    await expect(page.locator(".wordsocket-prompt--banner")).toContainText(
      "Back with us",
    );
    await setHidden(page, false);
    await expect(page.locator(".wordsocket-prompt--banner")).toContainText(
      "Back with us",
    );
    await expect.poll(() => page.title()).toBe(original);
    expect(await page.evaluate(() => window.__stubFired.length)).toBe(1);
  });

  test("fired on a hidden tab, the flash keeps to the action's delay, and an early return runs the action when the delay is up", async ({
    page,
    requestUtils,
  }) => {
    const original = await page.title();
    await requestUtils.rest({
      method: "POST",
      path: RULES,
      data: {
        rules: [
          rule({
            id: "e2e-flash-after",
            frequency: "always",
            conditions: {
              all: [{ condition: "time_hidden", op: "at_least", value: 1 }],
            },
            actions: [
              {
                action: "show",
                after: 3,
                presentation: { type: "banner", pattern: 0, text: "In time" },
              },
            ],
            attention: { enabled: true, title: "Come back" },
          }),
        ],
      },
    });
    await arrive(page, "/");
    await forget(page);
    await page.waitForTimeout(500);
    const banner = page.locator(".wordsocket-prompt--banner");
    // Fired at one second hidden; the banner opens, and with it the flash, when the delay is up.
    await setHidden(page, true);
    await page.waitForTimeout(2_300);
    expect(await page.title()).toBe(original);
    await expect(banner).toHaveCount(0);
    await expect.poll(() => page.title(), { timeout: 4_000 }).toBe("Come back");
    await expect(banner).toContainText("In time");
    await setHidden(page, false);
    await expect(banner).toContainText("In time");
    await expect.poll(() => page.title()).toBe(original);
    await banner.locator(".wordsocket-prompt__close").click();

    // Back before the delay is up: no flash was seen, and the banner arrives when the delay is up.
    await setHidden(page, true);
    await page.waitForTimeout(1_800);
    expect(await page.title()).toBe(original);
    await setHidden(page, false);
    await page.waitForTimeout(1_000);
    await expect(banner).toHaveCount(0);
    await expect(banner).toContainText("In time", { timeout: 4_000 });
    expect(await page.title()).toBe(original);
  });

  test("an extension's condition and action run through the engine and the firing is reported", async ({
    page,
    requestUtils,
  }) => {
    await requestUtils.rest({
      method: "POST",
      path: RULES,
      data: {
        rules: [
          rule({
            id: "e2e-stub",
            frequency: "always",
            conditions: {
              all: [{ condition: "stub_flag", op: "is", value: true }],
            },
            actions: [{ action: "stub_log", message: "hello from a rule" }],
          }),
        ],
      },
    });
    await arrive(page, "/");
    await forget(page);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__stubFired.length)).toBe(0);

    // The flag flips, the context is touched, the condition turns true: a transition.
    await page.evaluate(() => {
      window.__stubFlag = true;
      window.__stubTouch();
    });
    await expect
      .poll(() => page.evaluate(() => window.__stubFired.length))
      .toBe(1);
    const fired = await page.evaluate(() => window.__stubFired[0]);
    expect(fired.page.kind).toBe("home");
    expect(fired.params.message).toBe("hello from a rule");

    // onFire in the browser and wpsignal_rule_fired in PHP, through the stub's transient.
    await expect
      .poll(
        () => {
          try {
            return JSON.parse(
              wp("transient", "get", "stub_rule_fired", "--format=json"),
            ) as Record<string, unknown>;
          } catch {
            return null;
          }
        },
        { timeout: 10_000 },
      )
      .toMatchObject({
        rule_id: "e2e-stub",
        action: "stub_log",
        user_id: expect.any(Number),
      });
  });

  test("a synced pattern renders in the prompt, and a deleted one falls back to the text", async ({
    page,
    browser,
    baseURL,
    requestUtils,
  }) => {
    const block = (await requestUtils.rest({
      method: "POST",
      path: "/wp/v2/blocks",
      data: {
        title: "E2E prompt pattern",
        status: "publish",
        content:
          "<!-- wp:paragraph --><p>Pattern says hi</p><!-- /wp:paragraph -->",
      },
    })) as { id: number };
    await requestUtils.rest({
      method: "POST",
      path: RULES,
      data: {
        rules: [
          rule({
            id: "e2e-pattern",
            frequency: "always",
            actions: [
              {
                action: "show",
                presentation: {
                  type: "panel",
                  pattern: block.id,
                  text: "Plain fallback",
                },
              },
            ],
          }),
        ],
      },
    });
    await arrive(page, "/");
    await forget(page);
    await arrive(page, postUrl);
    const panel = page.locator(".wordsocket-prompt--panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toContainText("Pattern says hi");

    await requestUtils.rest({
      method: "DELETE",
      path: `/wp/v2/blocks/${block.id}`,
      params: { force: true },
    });
    const other = await browser.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: await page.context().storageState(),
    });
    try {
      const fresh = await other.newPage();
      await arrive(fresh, "/");
      await forget(fresh);
      await arrive(fresh, postUrl);
      const fallback = fresh.locator(".wordsocket-prompt--panel");
      await expect(fallback).toBeVisible({ timeout: 10_000 });
      await expect(fallback).toContainText("Plain fallback");
    } finally {
      await other.close();
    }
  });
});

declare global {
  interface Window {
    __stubFlag: boolean;
    __stubTouch: () => void;
    __stubFired: Array<{ page: { kind: string }; params: { message: string } }>;
  }
}
