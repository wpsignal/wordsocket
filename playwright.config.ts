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
  // The site is already running; nothing to start.
  webServer: undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
});
