/*
 * The visit and leave reports a tracked visitor sends WordPress, through `wpPost` with `keepalive`.
 * Best effort: a crash sends nothing, which is what relay presence is for.
 */

import { wpPost } from "../utils/rest";

/**
 * A visit or leave report as sent to WordPress.
 *
 * @since 0.30.0
 */
export interface PresenceReport {
  /** The visitor id (the browser). */
  v: string;
  /** The journey id (this visit). */
  n: string;
  journey: string;
  /** The extension's own fields, as given to `track()`. */
  data?: Record<string, unknown>;
  /**
   * Whole seconds since the report was true, for a leave sent from the outbox; absent when live.
   *
   * @since 0.31.0
   */
  ago?: number;
}

/**
 * What WordPress answered a report: `{ ok, ...fields }` from the response filter.
 *
 * @since 0.31.0
 */
export type ReportAnswer = Record<string, unknown>;

/**
 * Send a report and resolve to what WordPress answered, or null when it did not (offline, refused,
 * an unloading page); a leave's answer is never read.
 *
 * @since 0.31.0 Returns the answer, and sends the nonce the client holds rather than one passed in.
 */
export async function sendReport(
  url: string,
  report: PresenceReport,
  keepalive = false,
): Promise<ReportAnswer | null> {
  try {
    const res = await wpPost(url, report, keepalive);
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
