import "../env";
import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import { request } from "@playwright/test";
import { WPS_API_URL, dashboardLogin } from "../env";
import { connectViaRest, waitForState } from "./helpers";

/**
 * Revoked credentials: regenerating the dashboard API key deletes the user's
 * sites on the server. The browser's next connection is refused with 4001,
 * the client re-mints once (the plugin still signs with the old secret), is
 * refused again, and halts with authentication-failed instead of retrying.
 */
test.describe("Authentication", () => {
  test("a revoked site halts the client with authentication-failed", async ({ page, requestUtils }) => {
    await page.goto("/");
    await waitForState(page, { connected: true });

    const { token } = await dashboardLogin();
    const api = await request.newContext({ ignoreHTTPSErrors: true });
    const response = await api.post(`${WPS_API_URL}/api/dashboard/regenerate-key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok()).toBe(true);
    const { api_key: newKey } = await response.json();
    await api.dispose();

    // Fresh page load: the stored credentials no longer exist on the server.
    await page.reload();
    await waitForState(page, { connected: false, errorCode: "authentication-failed" });
    const state = await page.evaluate(() => window.WPS!.state);
    expect(state.retryInMs).toBeUndefined();

    // Restore: connect with the new key (a new site, since the old one was deleted).
    await requestUtils.rest({ method: "POST", path: "/wpsignal/v1/disconnect" });
    await connectViaRest(requestUtils, newKey);
    await page.reload();
    await waitForState(page, { connected: true, transport: "ws" });
  });
});
