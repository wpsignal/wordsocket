import { expect, type Page } from "@playwright/test";
import type { Admin, RequestUtils } from "@wordpress/e2e-test-utils-playwright";
import { WPS_E2E_EMAIL, storedSiteKey } from "../env";

export const SETTINGS_QUERY = "page=wordsocket";

/** Wait until window.WPS reports the wanted connection state on the current page. */
export async function waitForState(page: Page, expected: { connected: boolean; transport?: "ws" | "sse"; errorCode?: string }) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = window.WPS?.state;
          return s ? { connected: s.connected, transport: s.transport, errorCode: s.error?.code ?? null } : null;
        }),
      { timeout: 20_000 },
    )
    .toMatchObject({
      connected: expected.connected,
      ...(expected.transport ? { transport: expected.transport } : {}),
      ...(expected.errorCode ? { errorCode: expected.errorCode } : {}),
    });
}

/** Disconnect through the REST route (no UI) and confirm the site key is gone. */
export async function disconnectViaRest(requestUtils: RequestUtils): Promise<void> {
  if (storedSiteKey() === "") return;
  await requestUtils.rest({ method: "POST", path: "/wpsignal/v1/disconnect" });
  expect(storedSiteKey()).toBe("");
}

/** Connect through the REST route with an API key; returns the site key. */
export async function connectViaRest(requestUtils: RequestUtils, apiKey: string): Promise<string> {
  const response = await requestUtils.rest({ method: "POST", path: "/wpsignal/v1/connect", data: { api_key: apiKey } });
  expect(response.site_key, JSON.stringify(response)).toBeTruthy();
  return response.site_key as string;
}

/** Drive the Manual tab: paste the key, save, expect the Connected banner. */
export async function connectManually(admin: Admin, page: Page, apiKey: string): Promise<void> {
  await admin.visitAdminPage("admin.php", SETTINGS_QUERY);
  await expect(page.getByText("Not connected to WPSignal").first()).toBeVisible();
  await page.getByRole("tab", { name: "Manual" }).click();
  await page.getByLabel("API Key").fill(apiKey);
  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Connected", { exact: false }).first()).toBeVisible();
  expect(storedSiteKey()).not.toBe("");
}

/** Drive the Automatic tab through the dashboard's Authorize page and back. */
export async function connectAutomatically(admin: Admin, page: Page): Promise<void> {
  await admin.visitAdminPage("admin.php", SETTINGS_QUERY);
  await page.getByRole("tab", { name: "Automatic" }).click();
  await page.getByRole("button", { name: "Connect with WPSignal" }).click();

  // Dashboard (other origin): already logged in through the stored session.
  await expect(page.getByText("Authorizing as")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".account-email")).toHaveText(WPS_E2E_EMAIL);
  await page.getByRole("button", { name: "Authorize" }).click();

  // Back in wp-admin with the connected notice.
  await page.waitForURL(/page=wordsocket/, { timeout: 15_000 });
  await expect(page.getByText("Connected", { exact: false }).first()).toBeVisible();
  expect(storedSiteKey()).not.toBe("");
}

/** Disconnect through the UI: button, confirmation, "Not connected" notice. */
export async function disconnectViaUi(admin: Admin, page: Page): Promise<void> {
  await admin.visitAdminPage("admin.php", SETTINGS_QUERY);
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("button", { name: "Yes, disconnect" }).click();
  await expect(page.getByText("Not connected to WPSignal").first()).toBeVisible();
  expect(storedSiteKey()).toBe("");
}
