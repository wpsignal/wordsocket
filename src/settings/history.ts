/*
 * WordSocket's own history provider for the Moments tab's replay: the journeys the site keeps while
 * History is on, from `GET /wpsignal/v1/journeys`. An extension that registers its own afterwards
 * replaces it.
 */

/**
 * Internal dependencies.
 */
import { getJourneys } from "./api";

/**
 * Register the provider with `WPS.rules` when History is on; a no-op otherwise.
 *
 * @since 0.31.0
 */
export function installHistoryProvider(): void {
  const history = window.wpsignalSettings?.history;
  const rules = window.WPS?.rules;
  if (!history?.enabled || !rules) return;
  rules.history({
    outcomes: true,
    currency: history.currency || undefined,
    load: (options) => getJourneys(options).then((res) => res.journeys),
  });
}
