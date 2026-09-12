import { WPS_API_URL, WPS_E2E_EMAIL, WP_PASSWORD, WP_USERNAME, dashboardLogin, storedSiteKey, wp } from "./env";
import { request, type FullConfig } from "@playwright/test";
import { RequestUtils } from "@wordpress/e2e-test-utils-playwright";
import { readFile, writeFile } from "node:fs/promises";

/**
 * Same job as @wordpress/scripts' global setup (log in through RequestUtils
 * and store the session), plus the rehearsal wiring:
 *
 * 1. Refuse anything but a local or development site, and refuse a site whose
 *    WordSocket server is not the rehearsal server (the suite disconnects and
 *    revokes credentials, so production and the dev site are off limits).
 * 2. Make sure the E2E administrator exists.
 * 3. Log in to the rehearsal dashboard and add that session (localStorage on
 *    the API origin) to the stored browser state, so a test can walk from
 *    wp-admin to the dashboard's Authorize page without a login form.
 * 4. Leave the site connected, using the seeded account's API key, so specs
 *    that only read the connection have a baseline.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const env = wp("eval", "echo wp_get_environment_type();");
  if (!["local", "development"].includes(env)) {
    throw new Error(`Refusing to run against a '${env}' site; expected local or development.`);
  }
  if (wp("plugin", "list", "--name=wordsocket", "--status=active", "--field=name") !== "wordsocket") {
    throw new Error("WordSocket is not active on the target site.");
  }
  const serverUrl = wp("eval", "echo \\WPSignal\\WPS::instance()->config()->base_url();");
  if (serverUrl.replace(/\/$/, "") !== WPS_API_URL.replace(/\/$/, "")) {
    throw new Error(
      `The target site talks to ${serverUrl}, not the rehearsal server ${WPS_API_URL}. ` +
        "Run api/scripts/local-tls.sh --e2e-site <wp-root> against a dedicated E2E site.",
    );
  }

  if (wp("user", "list", `--login=${WP_USERNAME}`, "--field=user_login") !== WP_USERNAME) {
    wp("user", "create", WP_USERNAME, `${WP_USERNAME}@example.com`, "--role=administrator", `--user_pass=${WP_PASSWORD}`);
  } else {
    wp("user", "update", WP_USERNAME, `--user_pass=${WP_PASSWORD}`);
  }

  const { storageState, baseURL } = config.projects[0].use;
  const storageStatePath = typeof storageState === "string" ? storageState : undefined;
  const requestContext = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
  const requestUtils = new RequestUtils(requestContext, { storageStatePath });
  await requestUtils.setupRest();

  // Dashboard session on the API origin, alongside the WordPress cookies.
  const session = await dashboardLogin();
  if (storageStatePath) {
    const state = JSON.parse(await readFile(storageStatePath, "utf8"));
    state.origins = [
      {
        origin: WPS_API_URL,
        localStorage: Object.entries({
          wpsignal_token: session.token,
          wpsignal_api_key: session.api_key,
          wpsignal_role: session.role,
        })
          .filter(([, value]) => typeof value === "string")
          .map(([name, value]) => ({ name, value: value as string })),
      },
    ];
    await writeFile(storageStatePath, JSON.stringify(state), "utf8");
  }

  // Baseline: connected with the seeded account's key. `settings` asks the
  // server whether the stored site still exists, so a previous run that ended
  // revoked or disconnected is repaired here.
  const settings = await requestUtils.rest({ path: "/wpsignal/v1/settings" });
  if (!settings?.is_connected) {
    if (storedSiteKey() !== "") {
      await requestUtils.rest({ method: "POST", path: "/wpsignal/v1/disconnect" });
    }
    const response = await requestUtils.rest({
      method: "POST",
      path: "/wpsignal/v1/connect",
      data: { api_key: session.api_key },
    });
    if (!response?.site_key) {
      throw new Error(`Could not connect the E2E site as ${WPS_E2E_EMAIL}: ${JSON.stringify(response)}`);
    }
  }

  await requestContext.dispose();
}
