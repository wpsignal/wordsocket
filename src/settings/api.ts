/**
 * WordPress dependencies.
 */
import apiFetch from "@wordpress/api-fetch";

/**
 * Internal dependencies.
 */
import type { Trigger, Settings, ConnectResponse, SettingsPost } from "./types";

/**
 * Types.
 */
interface TriggersResponse {
  triggers: Trigger[];
  message?: string;
}

/**
 * Fetch the triggers.
 *
 * @since 0.7.0
 */
export function getTriggers(): Promise<TriggersResponse> {
  return apiFetch({ path: "/wpsignal/v1/triggers" });
}

/**
 * Save the triggers.
 *
 * @since 0.7.0
 */
export function saveTriggers(triggers: Trigger[]): Promise<TriggersResponse> {
  return apiFetch({
    path: "/wpsignal/v1/triggers",
    method: "POST",
    data: { triggers },
  });
}

/**
 * Save the ids of the notices this user closed to their user meta.
 *
 * @since 0.31.0
 */
export function saveDismissedNotices(ids: string[]): Promise<unknown> {
  return apiFetch({
    path: "/wp/v2/users/me",
    method: "POST",
    data: { meta: { wpsignal_dismissed_notices: ids } },
  });
}

/**
 * Fetch the settings.
 *
 * @since 0.7.0
 */
export function getSettings(): Promise<Settings> {
  return apiFetch({ path: "/wpsignal/v1/settings" });
}

/**
 * Save the given settings.
 *
 * @since 0.7.0
 */
export function saveSettings(settings: SettingsPost): Promise<SettingsPost> {
  return apiFetch({
    path: "/wpsignal/v1/settings",
    method: "POST",
    data: settings,
  });
}

/**
 * Connect the site with an API key.
 *
 * @since 0.14.0
 */
export function connectWithApiKey(api_key: string): Promise<ConnectResponse> {
  return apiFetch({
    path: "/wpsignal/v1/connect",
    method: "POST",
    data: { api_key },
  });
}

/**
 * Disconnect the site.
 *
 * @since 0.7.0
 */
export function disconnect(): Promise<{ ok: boolean }> {
  return apiFetch({
    path: "/wpsignal/v1/disconnect",
    method: "POST",
  });
}

/**
 * Get a short-lived connection JWT for the current user.
 *
 * @since 0.7.0
 */
export function getToken(): Promise<{ token: string }> {
  return apiFetch({ path: "/wpsignal/v1/token" });
}

/**
 * Publish a test event via the server-side proxy (keeps site secret out of the browser).
 *
 * @since 0.14.0
 */
export function publishEvent(
  channel: string,
  event: string,
  data: unknown,
): Promise<{ ok: boolean }> {
  return apiFetch({
    path: "/wpsignal/v1/publish",
    method: "POST",
    data: { channel, event, data },
  });
}

/**
 * Fetch the registered extensions.
 *
 * @since 0.21.0
 */
export function getExtensions(): Promise<{
  extensions: WordSocketExtensionInfo[];
}> {
  return apiFetch({ path: "/wpsignal/v1/extensions" });
}

/**
 * The Journeys tab's figures, computed again past the server's cache when `fresh`; null with History off.
 *
 * @since 0.31.0
 */
export function getJourneyVisuals(
  fresh = false,
): Promise<import("./types").JourneyVisuals | null> {
  return apiFetch({
    path: `/wpsignal/v1/journeys/visuals${fresh ? "?fresh=1" : ""}`,
  });
}

/**
 * One page of a month's journeys for the network, newest first; null with History off.
 *
 * @since 0.31.0
 */
export function getJourneyPage(
  month: string,
  page: number,
): Promise<{ journeys: import("./types").JourneyRow[] } | null> {
  const query = new URLSearchParams({ month, page: String(page) });
  return apiFetch({
    path: `/wpsignal/v1/journeys/visuals/journeys?${query}`,
  });
}

/**
 * Delete stored journeys: every one, or those started between two `YYYY-MM-DD` days on the site's clock.
 *
 * @since 0.31.0
 */
export function purgeJourneys(range: {
  from?: string;
  to?: string;
}): Promise<{ deleted: number }> {
  const query = new URLSearchParams();
  if (range.from) query.set("from", range.from);
  if (range.to) query.set("to", range.to);
  const q = query.toString();
  return apiFetch({
    path: `/wpsignal/v1/journeys${q ? `?${q}` : ""}`,
    method: "DELETE",
  });
}

/**
 * The stored journeys for the Moments tab's replay.
 *
 * @since 0.31.0
 */
export function getJourneys(options: {
  days?: number;
  limit?: number;
}): Promise<{
  enabled: boolean;
  currency: string;
  journeys: WPSHistoryJourney[];
}> {
  const query = new URLSearchParams();
  if (options.days) query.set("days", String(options.days));
  if (options.limit) query.set("limit", String(options.limit));
  return apiFetch({ path: `/wpsignal/v1/journeys?${query.toString()}` });
}

/**
 * Fetch the rules listing.
 *
 * @since 0.31.0
 */
export function getRules(): Promise<import("./TabRules/model").RulesListing> {
  return apiFetch({ path: "/wpsignal/v1/rules" });
}

/**
 * Save the rules; the answer is the fresh listing.
 *
 * @since 0.31.0
 */
export function saveRules(data: {
  rules: import("../rules/types").Rule[];
}): Promise<import("./TabRules/model").RulesListing> {
  return apiFetch({
    path: "/wpsignal/v1/rules",
    method: "POST",
    data,
  });
}
