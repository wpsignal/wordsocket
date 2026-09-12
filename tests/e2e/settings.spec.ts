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

  test("Explorer tab shows a live connection", async ({ admin, page }) => {
    await admin.visitAdminPage("admin.php", "page=wordsocket");
    await page.getByRole("tab", { name: "Explorer" }).click();
    await expect
      .poll(() => page.evaluate(() => window.WPS?.state.connected ?? false), { timeout: 15_000 })
      .toBe(true);
  });
});
