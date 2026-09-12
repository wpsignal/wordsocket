import "../env";
import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { dashboardLogin, storedSiteKey } from "../env";
import { connectAutomatically, connectManually, connectViaRest, disconnectViaRest, disconnectViaUi } from "./helpers";

/**
 * Full connection lifecycle against the rehearsal server. Each test leaves the
 * site connected; a failure in the middle leaves it disconnected, which the
 * next run's global setup repairs.
 */
test.describe("Connection lifecycle", () => {
  test("manual connect with an API key, disconnect, reconnect keeps the site key", async ({ admin, page, requestUtils }) => {
    const { api_key } = await dashboardLogin();
    await disconnectViaRest(requestUtils);

    await connectManually(admin, page, api_key);
    const firstKey = storedSiteKey();

    await disconnectViaUi(admin, page);

    // Reconnecting the same site URL reactivates the archived site: same key.
    await connectManually(admin, page, api_key);
    expect(storedSiteKey()).toBe(firstKey);
  });

  test("a wrong API key is refused with the server's reason and stores nothing", async ({ admin, page, requestUtils }) => {
    const { api_key } = await dashboardLogin();
    await disconnectViaRest(requestUtils);

    await admin.visitAdminPage("admin.php", "page=wordsocket");
    await page.getByRole("tab", { name: "Manual" }).click();
    await page.getByLabel("API Key").fill("f".repeat(64));
    await page.getByRole("button", { name: "Save Settings" }).click();
    await expect(page.getByText("invalid API key", { exact: false }).first()).toBeVisible();
    expect(storedSiteKey()).toBe("");
    // The form is usable again, not stuck busy.
    await expect(page.getByRole("button", { name: "Save Settings" })).toBeEnabled();

    await connectViaRest(requestUtils, api_key);
  });

  test("automatic connect through the dashboard's Authorize page", async ({ admin, page, requestUtils }) => {
    const before = storedSiteKey();
    await disconnectViaRest(requestUtils);

    await connectAutomatically(admin, page);
    expect(storedSiteKey()).toBe(before);
  });
});
