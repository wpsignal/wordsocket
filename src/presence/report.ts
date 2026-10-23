/*
 * The visit and leave reports a tracked visitor sends WordPress, through `fetch` with `keepalive`
 * so a logged-in visitor keeps the REST nonce. Best effort: a crash sends nothing, which is what
 * relay presence is for.
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

export function sendReport(
  url: string,
  report: PresenceReport,
  nonce?: string,
  keepalive = false,
): void {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
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
