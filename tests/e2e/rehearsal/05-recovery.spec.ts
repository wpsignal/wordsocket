import "../env";
import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { waitForState } from "./helpers";

/*
 * The surfaces and the attention reading behind rules (0.31), exercised with
 * no rule, no option and no request: `WPS.recovery` and `WPS.attention` on a
 * logged-in front-end page.
 */
test.describe("Recovery surfaces and attention", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForState(page, { connected: true, transport: "ws" });
    await page.evaluate(() =>
      window.localStorage.removeItem("wordsocket-rules"),
    );
  });

  test("a modal opens as a dialog beside a second prompt, and closes on Escape", async ({
    page,
  }) => {
    const first = await page.evaluate(() =>
      window.WPS!.recovery.show({ text: "Still there, {site.name}?" }, "modal"),
    );
    expect(first).toBe(true);
    const dialog = page.locator("dialog.wordsocket-prompt--modal[open]");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".wordsocket-prompt__text")).toContainText(
      "Still there,",
    );
    // Prompts stack: a second one opens alongside and outlives the dialog.
    expect(
      await page.evaluate(() =>
        window.WPS!.recovery.show({ text: "second" }, "banner"),
      ),
    ).toBe(true);
    await expect(page.locator(".wordsocket-prompt--banner")).toBeVisible();
    expect(await page.evaluate(() => window.WPS!.recovery.open)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => window.WPS!.recovery.open)).toBe(true);
    await page.evaluate(() => window.WPS!.recovery.close());
    await expect(page.locator(".wordsocket-prompt")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.WPS!.recovery.open))
      .toBe(false);
    expect(
      await page.evaluate(
        () => document.querySelectorAll(".wordsocket-prompt").length,
      ),
    ).toBe(0);
    expect(
      await page.evaluate(() =>
        document.body.classList.contains("wordsocket-prompt-open"),
      ),
    ).toBe(false);
  });

  test("banner, bar, toast and panel each render one prompt and close by their button", async ({
    page,
  }) => {
    for (const presentation of ["banner", "bar", "toast", "panel"]) {
      expect(
        await page.evaluate(
          (p) => window.WPS!.recovery.show({ text: `A ${p}` }, p),
          presentation,
        ),
      ).toBe(true);
      const prompt = page.locator(`.wordsocket-prompt--${presentation}`);
      await expect(prompt).toHaveCount(1);
      await expect(prompt).toContainText(`A ${presentation}`);
      await prompt.locator(".wordsocket-prompt__close").click();
      await expect(prompt).toHaveCount(0);
    }
    expect(
      await page.evaluate(
        () => document.querySelectorAll(".wordsocket-prompt").length,
      ),
    ).toBe(0);
  });

  test("a dismissed prompt is not remembered, and an unknown presentation falls back to the banner", async ({
    page,
  }) => {
    await page.evaluate(() =>
      window.WPS!.recovery.show({ text: "Rule one" }, "no-such-presentation", {
        rule: "r1",
      }),
    );
    await expect(page.locator(".wordsocket-prompt--banner")).toBeVisible();
    await page.locator(".wordsocket-prompt__close").click();
    await expect(page.locator(".wordsocket-prompt")).toHaveCount(0);
    await page.evaluate(() =>
      window.WPS!.recovery.show({ text: "Rule one" }, "no-such-presentation", {
        rule: "r1",
      }),
    );
    await expect(page.locator(".wordsocket-prompt--banner")).toBeVisible();
    const stored = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("wordsocket-rules") ?? "{}"),
    );
    expect(stored.dismissed).toBeUndefined();
  });

  test("attention reads hidden, window and page, and a focused iframe is not a blur", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await page.evaluate(() => window.WPS!.attention.state)).toBe("page");
    await page.evaluate(() => {
      window.__attention = [];
      window.WPS!.attention.on((state) => window.__attention.push(state));
    });

    // Another window in front: desktop only, so Playwright's desktop Chromium reads it.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    expect(await page.evaluate(() => window.WPS!.attention.state)).toBe(
      "window",
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect(await page.evaluate(() => window.WPS!.attention.state)).toBe("page");

    // Focus into an iframe fires blur on the window; the visitor is still here.
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.id = "wps-frame";
      document.body.appendChild(frame);
      frame.focus();
      window.dispatchEvent(new Event("blur"));
    });
    expect(await page.evaluate(() => window.WPS!.attention.state)).toBe("page");
    await page.evaluate(() => {
      document.getElementById("wps-frame")?.remove();
      (document.activeElement as HTMLElement | null)?.blur?.();
    });

    // Hidden wins over everything, and the return is reported.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await page.evaluate(() => window.WPS!.attention.state)).toBe(
      "hidden",
    );
    await page.evaluate(() => {
      window.__returned = 0;
      window.WPS!.recovery.onReturn(() => (window.__returned += 1));
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await page.evaluate(() => window.WPS!.attention.state)).toBe("page");
    expect(await page.evaluate(() => window.__returned)).toBe(1);
    expect(await page.evaluate(() => window.__attention)).toEqual([
      "window",
      "page",
      "hidden",
      "page",
    ]);
  });

  test("the title flashes while hidden and is restored on return", async ({
    page,
  }) => {
    const original = await page.title();
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      window.__flash = window.WPS!.recovery.flashTitle("Come back");
    });
    await expect.poll(() => page.title()).toBe("Come back");
    await expect.poll(() => page.title(), { timeout: 5_000 }).toBe(original);
    await expect.poll(() => page.title(), { timeout: 5_000 }).toBe("Come back");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => page.title()).toBe(original);
    await page.waitForTimeout(2_000);
    expect(await page.title()).toBe(original);
  });

  test("the sound refuses before a gesture, plays once after one, and not again this visit", async ({
    page,
  }) => {
    await page.evaluate(() =>
      window.sessionStorage.removeItem("wordsocket-sound"),
    );
    expect(await page.evaluate(() => window.WPS!.recovery.sound())).toBe(false);
    // A key press is a gesture too, and unlike a click it cannot land on a link.
    await page.keyboard.press("Shift");
    expect(await page.evaluate(() => window.WPS!.recovery.sound())).toBe(true);
    // JSON through `src/utils/storage.ts`, like every other flag.
    expect(
      await page.evaluate(() =>
        window.sessionStorage.getItem("wordsocket-sound"),
      ),
    ).toBe("true");
    expect(await page.evaluate(() => window.WPS!.recovery.sound())).toBe(false);
  });
});

declare global {
  interface Window {
    __attention: string[];
    __returned: number;
    __flash: { stop(): void };
  }
}
