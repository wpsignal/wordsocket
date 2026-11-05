/*
 * WordSocket's own history provider for the Moments tab's replay: the journeys the site has kept,
 * from `GET /wpsignal/v1/journeys`, History on or off. An extension that registers its own afterwards
 * replaces it.
 */

/**
 * Internal dependencies.
 */
import { getJourneys } from "./api";

/**
 * Register the provider with `WPS.rules`; a no-op without the client.
 *
 * @since 0.31.0
 * @since 0.31.0 Registered with History off as well, since what was kept stays readable (2026-11-01).
 */
export function installHistoryProvider(): void {
  const history = window.wpsignalSettings?.history;
  const rules = window.WPS?.rules;
  if (!rules) return;
  rules.history({
    outcomes: true,
    currency: history?.currency || undefined,
    load: (options) => getJourneys(options).then((res) => res.journeys),
  });
}
