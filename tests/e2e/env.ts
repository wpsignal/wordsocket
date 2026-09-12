/**
 * Environment defaults for the E2E suite. Imported first so the values are in
 * place before `@wordpress/e2e-test-utils-playwright` reads them at load time.
 *
 * The suite targets the dedicated E2E WordPress (created in Lempify) that
 * `api/scripts/local-tls.sh --e2e-site <root>` pins at the rehearsal server.
 * It connects, disconnects, and revokes credentials there, so it must never be
 * pointed at the site you develop against or at production; global-setup
 * refuses both.
 *
 *   WP_BASE_URL       https://e2e.wpsignal.local
 *   WP_ROOT           /opt/homebrew/var/www/e2e.wpsignal.local   (wp-cli target)
 *   WP_USERNAME       wps-e2e          administrator created or reset on each run
 *   WP_PASSWORD       wps-e2e-password
 *   WPS_API_URL       https://api.wpsignal.local:8443           (local-tls.sh)
 *   WPS_E2E_EMAIL     e2e@wpsignal.local                        (local-tls.sh --seed-e2e)
 *   WPS_E2E_PASSWORD  e2e-password-1
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { request } from "@playwright/test";

process.env.WP_BASE_URL ??= "https://e2e.wpsignal.local";
process.env.WP_ROOT ??= "/opt/homebrew/var/www/e2e.wpsignal.local";
process.env.WP_USERNAME ??= "wps-e2e";
process.env.WP_PASSWORD ??= "wps-e2e-password";
process.env.WPS_API_URL ??= "https://api.wpsignal.local:8443";
process.env.WPS_E2E_EMAIL ??= "e2e@wpsignal.local";
process.env.WPS_E2E_PASSWORD ??= "e2e-password-1";

// The WordPress fixtures build their REST request context without
// ignoreHTTPSErrors, so Node must trust the mkcert root CA that signs the
// local certificates. Playwright's driver inherits this environment.
if (!process.env.NODE_EXTRA_CA_CERTS) {
  try {
    const caRoot = execFileSync("mkcert", ["-CAROOT"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const pem = join(caRoot, "rootCA.pem");
    if (existsSync(pem)) {
      process.env.NODE_EXTRA_CA_CERTS = pem;
    }
  } catch {
    // mkcert not installed: only matters for HTTPS targets with private CAs.
  }
}

export const WP_ROOT = process.env.WP_ROOT;
export const WP_USERNAME = process.env.WP_USERNAME;
export const WP_PASSWORD = process.env.WP_PASSWORD;
export const WPS_API_URL = process.env.WPS_API_URL;
export const WPS_E2E_EMAIL = process.env.WPS_E2E_EMAIL;
export const WPS_E2E_PASSWORD = process.env.WPS_E2E_PASSWORD;

/** Run a wp-cli command against the target site and return trimmed stdout. */
export function wp(...args: string[]): string {
  return execFileSync(
    "php",
    ["-d", "error_reporting=0", "/opt/homebrew/bin/wp", `--path=${WP_ROOT}`, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

/** The WordSocket site key stored on the target site ('' when disconnected). */
export function storedSiteKey(): string {
  try {
    return wp("option", "get", "wpsignal_site_key");
  } catch {
    return "";
  }
}

export type DashboardSession = { token: string; api_key: string; role?: string };

/**
 * Log in to the rehearsal dashboard as the seeded E2E user. Uses Playwright's
 * request API rather than fetch: NODE_EXTRA_CA_CERTS set above only reaches
 * processes started afterwards, and the Playwright driver is one of them.
 */
export async function dashboardLogin(): Promise<DashboardSession> {
  const context = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const response = await context.post(`${WPS_API_URL}/auth/login`, {
      data: { email: WPS_E2E_EMAIL, password: WPS_E2E_PASSWORD },
    });
    if (!response.ok()) {
      throw new Error(`dashboard login failed (${response.status()}); run local-tls.sh --seed-e2e`);
    }
    return (await response.json()) as DashboardSession;
  } finally {
    await context.dispose();
  }
}
