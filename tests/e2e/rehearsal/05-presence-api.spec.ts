import "../env";
import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import type { Page } from "@playwright/test";
import { WP_USERNAME, wp } from "../env";
import { waitForState } from "./helpers";

/**
 * The Presence API bridge: a signed-in page's connection becomes the person's
 * `user-{id}` row (and the editor's `editor-{id}` row) in the Presence API
 * table, written by the relay's notification rather than by Heartbeat, held
 * for an hour, dropped to the TTL while every tab is hidden, and left to lapse
 * within a short grace when the last connection closes, so a refresh never
 * drops the person. Needs the Presence API plugin active on the E2E site,
 * which the global setup does not install.
 */
const PRESENCE_API_ACTIVE = wp("plugin", "list", "--name=presence-api", "--status=active", "--field=name") === "presence-api";
const HOUR = 3600;
const TTL = 150;
const GRACE = 10;

type PresenceRow = { user_id: string; data: string; window: number } | null;

/** The stored row for a room and client id, with its expiry window in seconds, or null. */
function presenceRow(room: string, clientId: string): PresenceRow {
  // `window` is a reserved word in MySQL 8, hence the short alias.
  const php =
    "global $wpdb; echo wp_json_encode( $wpdb->get_row( $wpdb->prepare( " +
    `"SELECT user_id, data, TIMESTAMPDIFF(SECOND, date_gmt, expires_gmt) AS w FROM {$wpdb->presence} WHERE room = %s AND client_id = %s", ` +
    `${JSON.stringify(room)}, ${JSON.stringify(clientId)} ) ) );`;
  const out = wp("eval", php);
  const row = JSON.parse(out.trim().split("\n").pop() ?? "null") as { user_id: string; data: string; w: string } | null;
  return row ? { user_id: row.user_id, data: row.data, window: Number(row.w) } : null;
}

/** Whether Presence API currently lists the client in the room (an expired row does not count). */
function listed(room: string, clientId: string): boolean {
  const php =
    `$rows = wp_get_presence( ${JSON.stringify(room)}, array( 'client_prefix' => ${JSON.stringify(clientId)} ) ); ` +
    `echo wp_json_encode( (bool) array_filter( $rows, fn( $r ) => $r->client_id === ${JSON.stringify(clientId)} ) );`;
  return wp("eval", php).trim().split("\n").pop() === "true";
}

async function openAdmin(page: Page, path = "index.php"): Promise<void> {
  await page.goto(`/wp-admin/${path}`);
  await waitForState(page, { connected: true, transport: "ws" });
}

test.describe("Presence API bridge", () => {
  test.skip(!PRESENCE_API_ACTIVE, "Presence API is not active on the E2E site");

  let userId = "";
  const adminRoom = "admin/online";

  test.beforeAll(() => {
    userId = wp("user", "get", WP_USERNAME, "--field=ID").trim();
    wp("eval", `wp_remove_presence( "admin/online", "user-${userId}" );`);
  });

  test("a signed-in page holds the person's row for an hour while Heartbeat stands down", async ({ page }) => {
    await openAdmin(page);
    await expect.poll(() => presenceRow(adminRoom, `user-${userId}`)?.window ?? 0, { timeout: 15_000 }).toBeGreaterThan(HOUR - 60);
    const row = presenceRow(adminRoom, `user-${userId}`)!;
    expect(row.user_id).toBe(userId);
    expect(JSON.parse(row.data)).toMatchObject({ screen: "dashboard", title: "Dashboard" });

    const keepalive = await page.evaluate(() => window.wp?.hooks?.applyFilters("presence-api.keepalive", true));
    expect(keepalive, "the bridge answers the keepalive filter with false").toBe(false);
  });

  test("a second tab closing keeps the row, the last tab closing lets it lapse within the grace", async ({ page, context }) => {
    await openAdmin(page);
    const second = await context.newPage();
    await openAdmin(second, "edit.php");
    await expect.poll(() => JSON.parse(presenceRow(adminRoom, `user-${userId}`)?.data ?? "{}").screen, { timeout: 15_000 }).toBe("edit-post");

    await second.close();
    await expect.poll(() => JSON.parse(presenceRow(adminRoom, `user-${userId}`)?.data ?? "{}").screen, { timeout: 15_000 }).toBe("dashboard");
    expect(presenceRow(adminRoom, `user-${userId}`)?.window ?? 0).toBeGreaterThan(HOUR - 60);

    await page.close();
    await expect.poll(() => presenceRow(adminRoom, `user-${userId}`)?.window ?? HOUR, { timeout: 15_000 }).toBeLessThanOrEqual(GRACE);
    expect(listed(adminRoom, `user-${userId}`), "still listed inside the grace").toBe(true);
    await expect.poll(() => listed(adminRoom, `user-${userId}`), { timeout: (GRACE + 10) * 1000 }).toBe(false);
  });

  test("a refresh never drops the person from the room", async ({ page }) => {
    await openAdmin(page);
    await expect.poll(() => presenceRow(adminRoom, `user-${userId}`)?.window ?? 0, { timeout: 15_000 }).toBeGreaterThan(HOUR - 60);

    const reload = page.reload().then(() => waitForState(page, { connected: true, transport: "ws" }));
    const samples: boolean[] = [];
    while (samples.length < 8) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      samples.push(listed(adminRoom, `user-${userId}`));
    }
    await reload;
    expect(samples, "listed throughout the reload").toEqual(samples.map(() => true));
    await expect.poll(() => presenceRow(adminRoom, `user-${userId}`)?.window ?? 0, { timeout: 15_000 }).toBeGreaterThan(HOUR - 60);
  });

  test("a hidden tab's row lapses at the TTL and comes back to the hour when it is visible again", async ({ page }) => {
    await openAdmin(page);
    await expect.poll(() => presenceRow(adminRoom, `user-${userId}`)?.window ?? 0, { timeout: 15_000 }).toBeGreaterThan(HOUR - 60);

    const setVisibility = (state: "hidden" | "visible") =>
      page.evaluate((value) => {
        Object.defineProperty(document, "visibilityState", { value, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      }, state);

    await setVisibility("hidden");
    await expect.poll(() => presenceRow(adminRoom, `user-${userId}`)?.window ?? 0, { timeout: 15_000 }).toBeLessThanOrEqual(TTL);

    await setVisibility("visible");
    await expect.poll(() => presenceRow(adminRoom, `user-${userId}`)?.window ?? 0, { timeout: 15_000 }).toBeGreaterThan(HOUR - 60);
  });

  test("the post editor holds the editor row in the post's room", async ({ page }) => {
    const postId = wp("post", "create", "--post_title=Presence bridge", "--post_status=draft", "--porcelain").trim();
    try {
      await openAdmin(page, `post.php?post=${postId}&action=edit`);
      const room = `postType/post:${postId}`;
      await expect.poll(() => presenceRow(room, `editor-${userId}`)?.window ?? 0, { timeout: 15_000 }).toBeGreaterThan(HOUR - 60);
      expect(JSON.parse(presenceRow(room, `editor-${userId}`)!.data)).toMatchObject({ action: "editing", screen: "post" });

      await page.close();
      await expect.poll(() => presenceRow(room, `editor-${userId}`)?.window ?? HOUR, { timeout: 15_000 }).toBeLessThanOrEqual(GRACE);
    } finally {
      wp("post", "delete", postId, "--force");
    }
  });
});
