import "./tests/e2e/env";
import { defineConfig } from "@playwright/test";
import baseConfig from "@wordpress/scripts/config/playwright.config";

/**
 * WordPress' Playwright defaults (@wordpress/scripts), pointed at the local
 * Lempify site instead of wp-env. Run with `npm run test:e2e`.
 */
export default defineConfig({
  ...baseConfig,
  testDir: "tests/e2e",
  globalSetup: require.resolve("./tests/e2e/global-setup.ts"),
  // The rehearsal server and its metrics sidecar are owned by the run: started
  // here (pinning the E2E site and seeding the dashboard user on the way) and
  // killed, process tree included, when the run ends. A stack started by hand
  // makes this refuse to run, so nothing is ever left behind by mistake.
  webServer: {
    command: `${process.env.WPS_LOCAL_TLS} --e2e-site ${process.env.WP_ROOT} --seed-e2e`,
    // The dashboard user the script seeds; the script has no defaults of its own.
    env: {
      E2E_EMAIL: process.env.WPS_E2E_EMAIL!,
      E2E_PASSWORD: process.env.WPS_E2E_PASSWORD!,
    },
    url: `${process.env.WPS_API_URL}/healthz`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  timeout: 30_000,
  expect: { timeout: 10_000 },
});
