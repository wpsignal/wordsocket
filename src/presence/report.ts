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

/** What WordPress answered a report: `{ ok, ...fields }` from the response filter. */
export type ReportAnswer = Record<string, unknown>;

/**
 * Send a report and resolve to what WordPress answered, or null when it did not (offline, refused,
 * an unloading page); a leave's answer is never read.
 *
 * @since 0.31.0 Returns the answer.
 */
export async function sendReport(
  url: string,
  report: PresenceReport,
  nonce?: string,
  keepalive = false,
): Promise<ReportAnswer | null> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (nonce) headers["X-WP-Nonce"] = nonce;
  try {
    const res = await fetch(url, {
      method: "POST",
      keepalive,
      credentials: "same-origin",
      headers,
      body: JSON.stringify(report),
    });
    if (!res.ok) return null;
    const answer: unknown = await res.json();
    return answer && typeof answer === "object"
      ? (answer as ReportAnswer)
      : null;
  } catch {
    // An unloading page may refuse the request; nothing to do.
    return null;
  }
}
