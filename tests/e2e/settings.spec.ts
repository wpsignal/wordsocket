import "./env";
import { expect, test } from "@wordpress/e2e-test-utils-playwright";

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

  test("Explorer tab shows a live connection", async ({ admin, page }) => {
    await admin.visitAdminPage("admin.php", "page=wordsocket");
    await page.getByRole("tab", { name: "Explorer" }).click();
    await expect
      .poll(() => page.evaluate(() => window.WPS?.state.connected ?? false), { timeout: 15_000 })
      .toBe(true);
  });
});
