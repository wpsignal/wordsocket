/*
 * The stored journeys for the replay, loaded once per mount from the provider an extension
 * registered; one load serves the list's reach counts and the editor's replay.
 */

/**
 * WordPress dependencies.
 */
import { useEffect, useState } from "@wordpress/element";

export interface Journeys {
  provider: WPSHistoryProvider | null;
  journeys: WPSHistoryJourney[] | null;
  loading: boolean;
  failed: boolean;
}

export const REPLAY_DAYS = 30;
export const REPLAY_LIMIT = 500;

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
