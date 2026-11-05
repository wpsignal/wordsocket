/*
 * The stored journeys for the replay, loaded once per mount from the provider an extension
 * registered; one load serves the list's reach counts and the editor's replay.
 */

/**
 * WordPress dependencies.
 */
import { useEffect, useState } from "@wordpress/element";

/**
 * The stored journeys and the state of their load.
 *
 * @since 0.31.0
 */
export interface Journeys {
  provider: WPSHistoryProvider | null;
  journeys: WPSHistoryJourney[] | null;
  loading: boolean;
  failed: boolean;
}

/**
 * The same window and ceiling as the Journeys tab, so both count the same journeys.
 *
 * @since 0.31.0
 */
export const REPLAY_DAYS = 28;
/**
 * Most journeys the replay loads.
 *
 * @since 0.31.0
 */
export const REPLAY_LIMIT = 1000;

/**
 * Load the stored journeys for the replay from the registered history provider.
 *
 * @since 0.31.0
 */
export function useJourneys(): Journeys {
  const provider = window.WPS?.rules?.historyProvider ?? null;
  const [journeys, setJourneys] = useState<WPSHistoryJourney[] | null>(null);
  const [loading, setLoading] = useState(Boolean(provider));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!provider) return undefined;
    let live = true;
    provider
      .load({ days: REPLAY_DAYS, limit: REPLAY_LIMIT })
      .then((loaded) => {
        if (live) setJourneys(loaded);
      })
      .catch(() => {
        if (live) setFailed(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [provider]);
  return { provider, journeys, loading, failed };
}
