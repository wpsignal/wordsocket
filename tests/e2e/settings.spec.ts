import "./env";
import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { wp } from "./env";

test.describe("WordSocket settings page", () => {
  test("a callback notice shows once and does not survive a reload", async ({ admin, page }) => {
    await admin.visitAdminPage("admin.php", "page=wordsocket&wps_notice=cancelled");

    // The load that carries the parameter shows the notice and strips the URL.
    await expect(page.getByText("Connection cancelled").first()).toBeVisible();
    await expect.poll(() => page.url()).not.toContain("wps_notice");

    // A reload sees the real connection state, not a stale "cancelled".
    await page.reload();
    await expect(page.getByText("Connected", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Connection cancelled")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  });

  test("Disconnect asks for confirmation and Cancel puts the button back", async ({ admin, page }) => {
    await admin.visitAdminPage("admin.php", "page=wordsocket");
    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("button", { name: "Yes, disconnect" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Yes, disconnect" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  });

  test("Extensions tab renders the stub extension's panel and the catalogue", async ({ admin, page }) => {
    /*
     * The Connect tab's ConnectionStatusSlot is hidden since 0.24.1, so the
     * stub's ConnectionStatusFill renders nowhere. Restore the check with it:
     * expect(page.locator(".stub-extension-status")).toHaveText("Stub extension is active.")
     */

    // Tabs are linkable: &tab=extensions opens the tab, and selecting one writes it back.
    await admin.visitAdminPage("admin.php", "page=wordsocket&tab=extensions");
    await expect(page.getByRole("tab", { name: "Extensions" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Explorer" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("explorer");
    await page.getByRole("tab", { name: "Extensions" }).click();
    const panel = page.locator(".wpsignal-extension[data-extension='wordsocket-stub-extension']");
    await expect(panel.getByRole("heading", { name: "Stub Extension" })).toBeVisible();
    await expect(panel.locator(".stub-extension-state")).toContainText("Site connected");
    await expect(panel.locator(".stub-extension-state")).toContainText("client online", { timeout: 15_000 });

    // Catalogue entries for extensions not installed here: ShopSocket is on
    // WordPress.org (0.27), the others are still coming.
    const woo = page.locator(".wpsignal-extension--catalogue[data-extension='shopsocket']");
    await expect(woo).toBeVisible();
    await expect(woo.getByRole("link", { name: "Get it" })).toBeVisible();
    await expect(page.locator(".wpsignal-extension--catalogue .wpsignal-extension__soon").first()).toHaveText("Coming soon");
  });

  test("an extension can add its own tab through wordsocket.registerTab", async ({ admin, page }) => {
    // The stub registers "Stub" (name stub-extension); it is linkable like the built-in tabs.
    await admin.visitAdminPage("admin.php", "page=wordsocket&tab=stub-extension");
    await expect(page.getByRole("tab", { name: "Stub" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".stub-extension-tab")).toContainText("Site connected");
    await page.getByRole("tab", { name: "Extensions" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("extensions");
  });

  test("the Moments switch on the Settings tab lists the Moments tab and takes it away", async ({ admin, page }) => {
    wp("option", "update", "wpsignal_moments_enabled", "0");
    try {
      await admin.visitAdminPage("admin.php", "page=wordsocket&tab=settings");
      await expect(page.getByRole("tab", { name: "Moments" })).toHaveCount(0);
      const card = page.locator(".wpsignal-collapsible-card", { hasText: "Moments" });
      await card.getByRole("button").first().click();
      const toggle = card.getByLabel("Enable", { exact: true });
      await expect(toggle).not.toBeChecked();
      await toggle.check();
      await expect(page.locator(".components-snackbar")).toContainText("Settings saved.");
      await expect(page.getByRole("tab", { name: "Moments" })).toBeVisible();
      expect(wp("option", "get", "wpsignal_moments_enabled")).toBe("1");
      await toggle.uncheck();
      await expect(page.getByRole("tab", { name: "Moments" })).toHaveCount(0);
      // A false option reads as empty, or as missing, depending on wp-cli.
      await expect
        .poll(() => {
          try {
            return wp("option", "get", "wpsignal_moments_enabled");
          } catch {
            return "";
          }
        })
        .toBe("");
    } finally {
      wp("option", "update", "wpsignal_moments_enabled", "1");
    }
  });

  test("Style prompts saves a style from the Moments card and the front end prints it", async ({ admin, page }) => {
    wp("option", "delete", "wpsignal_prompt_style");
    try {
      await admin.visitAdminPage("admin.php", "page=wordsocket&tab=settings");
      const card = page.locator(".wpsignal-collapsible-card", { hasText: "Moments" });
      await card.getByRole("button").first().click();
      await card.getByRole("button", { name: "Open Style Editor" }).click();
      const dialog = page.getByRole("dialog", { name: "Style prompts" });
      await expect(dialog).toBeVisible();
      // The theme's variables are on the page, so a preset built from them resolves in the sample as on the front end.
      expect(await page.evaluate(() => document.getElementById("wpsignal-settings-inline-css")?.textContent ?? "")).toContain("--wp--preset--spacing--");
      for (const tab of ["All prompts", "Modal", "Banner", "Bar", "Toast", "Panel"]) {
        await expect(dialog.getByRole("tab", { name: tab })).toBeVisible();
      }
      // All prompts: no shadow. The sample follows at once.
      const sample = dialog.locator(".wpsignal-prompt-sample");
      await dialog.getByRole("checkbox", { name: "Shadow" }).uncheck();
      await expect(sample).toHaveCSS("box-shadow", "none");
      // Modal: its own width, added from the panel's menu.
      await dialog.getByRole("tab", { name: "Modal" }).click();
      const modalPanel = dialog.getByRole("tabpanel");
      await modalPanel.getByRole("button", { name: "Modal options" }).click();
      await page.getByRole("menuitemcheckbox", { name: "Width" }).click();
      await page.keyboard.press("Escape");
      await expect(modalPanel.getByRole("slider", { name: "Width (px)" })).toBeVisible();
      await dialog.getByRole("button", { name: "Save styles" }).click();
      await expect(page.locator(".components-snackbar")).toContainText("Prompt styles saved.");
      await expect(dialog).toHaveCount(0);
      const saved = JSON.parse(wp("option", "get", "wpsignal_prompt_style", "--format=json")) as Record<string, Record<string, unknown>>;
      expect(saved.all).toEqual({ shadow: false });
      expect(saved.modal).toEqual({ padding: "50", width: 480 });
      // The dialog's preview link carries the open tab's presentation.
      await card.getByRole("button", { name: "Open Style Editor" }).click();
      await dialog.getByRole("tab", { name: "Toast" }).click();
      const link = dialog.getByRole("link", { name: "Preview on site" });
      expect(await link.getAttribute("href")).toMatch(/\/\?wordsocket-preview=toast$/);
      // The front end prints both scopes as custom properties after the client stylesheet.
      await page.goto("/");
      const css = await page.evaluate(() => document.getElementById("wpsignal-inline-css")?.textContent ?? "");
      expect(css).toContain("#wordsocket-prompts{--wordsocket-prompt-shadow:none;}");
      expect(css).toContain(".wordsocket-prompt--modal{--wordsocket-prompt-padding:var(--wp--preset--spacing--50, ");
      expect(css).toContain("--wordsocket-prompt-width:480px;");
      // The preview: the parameter shows a sample in that presentation, and so does the API.
      await page.goto("/?wordsocket-preview=toast");
      await expect(page.locator(".wordsocket-prompt--toast")).toContainText("Still there?");
      expect(await page.evaluate(() => window.WPS!.recovery.preview("panel"))).toBe(true);
      await expect(page.locator(".wordsocket-prompt--panel")).toBeVisible();
    } finally {
      wp("option", "delete", "wpsignal_prompt_style");
    }
  });

  test("Explorer tab shows a live connection", async ({ admin, page }) => {
    await admin.visitAdminPage("admin.php", "page=wordsocket");
    await page.getByRole("tab", { name: "Explorer" }).click();
    await expect
      .poll(() => page.evaluate(() => window.WPS?.state.connected ?? false), { timeout: 15_000 })
      .toBe(true);
  });
});
