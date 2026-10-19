/*
 * The two reports a tracked visitor sends WordPress.
 *
 * - A visit when a page opens (and when a journey starts over), a leave when
 *   the page is left.
 * - `fetch` with `keepalive` outlives the page like `sendBeacon` does, and
 *   unlike it can carry the REST nonce, so a logged-in visitor stays
 *   themselves instead of becoming a guest.
 * - Best effort by nature: a crash sends nothing, and that is what relay
 *   presence is for.
 */

export interface PresenceReport {
  /** The visitor id (the browser). */
  v: string;
  /** The journey id (this visit). */
  n: string;
  journey: string;
  /** The extension's own fields, as given to `track()`. */
  data?: Record<string, unknown>;
}

export function sendReport(url: string, report: PresenceReport, nonce?: string, keepalive = false): void {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nonce) headers["X-WP-Nonce"] = nonce;
  try {
    void fetch(url, {
      method: "POST",
      keepalive,
      credentials: "same-origin",
      headers,
      body: JSON.stringify(report),
    }).catch(() => undefined);
  } catch {
    // An unloading page may refuse the request; nothing to do.
  }
}
