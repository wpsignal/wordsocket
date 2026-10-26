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

export function getTriggers(): Promise<TriggersResponse> {
  return apiFetch({ path: "/wpsignal/v1/triggers" });
}

export function saveTriggers(triggers: Trigger[]): Promise<TriggersResponse> {
  return apiFetch({
    path: "/wpsignal/v1/triggers",
    method: "POST",
    data: { triggers },
  });
}

export function getSettings(): Promise<Settings> {
  return apiFetch({ path: "/wpsignal/v1/settings" });
}

export function saveSettings(settings: SettingsPost): Promise<SettingsPost> {
  return apiFetch({
    path: "/wpsignal/v1/settings",
    method: "POST",
    data: settings,
  });
}

export function connectWithApiKey(api_key: string): Promise<ConnectResponse> {
  return apiFetch({
    path: "/wpsignal/v1/connect",
    method: "POST",
    data: { api_key },
  });
}

export function disconnect(): Promise<{ ok: boolean }> {
  return apiFetch({
    path: "/wpsignal/v1/disconnect",
    method: "POST",
  });
}

/** Get a short-lived connection JWT for the current user. */
export function getToken(): Promise<{ token: string }> {
  return apiFetch({ path: "/wpsignal/v1/token" });
}

/**
 * Publish a test event via the server-side proxy (keeps site secret out of the browser).
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

export function getExtensions(): Promise<{
  extensions: WordSocketExtensionInfo[];
}> {
  return apiFetch({ path: "/wpsignal/v1/extensions" });
}

/**
 * The Journeys tab's figures; null with History off.
 *
 * @since 0.31.0
 */
export function getJourneyVisuals(): Promise<import("./types").JourneyVisuals | null> {
  return apiFetch({ path: "/wpsignal/v1/journeys/visuals" });
}

/**
 * The stored journeys for the Moments tab's replay.
 *
 * @since 0.31.0
 */
export function getJourneys(options: {
  days?: number;
  limit?: number;
}): Promise<{ enabled: boolean; currency: string; journeys: WPSHistoryJourney[] }> {
  const query = new URLSearchParams();
  if (options.days) query.set("days", String(options.days));
  if (options.limit) query.set("limit", String(options.limit));
  return apiFetch({ path: `/wpsignal/v1/journeys?${query.toString()}` });
}

export function getRules(): Promise<import("./TabRules/model").RulesListing> {
  return apiFetch({ path: "/wpsignal/v1/rules" });
}

/** Save the rules; the answer is the fresh listing. */
export function saveRules(data: {
  rules: import("../rules/types").Rule[];
}): Promise<import("./TabRules/model").RulesListing> {
  return apiFetch({
    path: "/wpsignal/v1/rules",
    method: "POST",
    data,
  });
}
