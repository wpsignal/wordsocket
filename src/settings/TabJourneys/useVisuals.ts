/*
 * The Journeys tab's figures, fetched once per mount from the visuals route, and the network's pages of
 * a month's journeys, each fetched once.
 */

/**
 * WordPress dependencies.
 */
import { useEffect, useRef, useState } from "@wordpress/element";

/**
 * Internal dependencies.
 */
import { getJourneyPage, getJourneyVisuals } from "../api";
import type { JourneyRow, JourneyVisuals } from "../types";

interface VisualsState {
  data: JourneyVisuals | null;
  loading: boolean;
  error: boolean;
}

/**
 * The visuals route's answer; `data` stays null until it arrives, and with History off.
 *
 * @since 0.31.0
 */
export function useVisuals(enabled: boolean): VisualsState {
  const [state, setState] = useState<VisualsState>({
    data: null,
    loading: enabled,
    error: false,
  });
  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, error: false });
      return undefined;
    }
    let alive = true;
    setState({ data: null, loading: true, error: false });
    getJourneyVisuals()
      .then((data) => {
        if (alive)
          setState({ data: data ?? null, loading: false, error: false });
      })
      .catch(() => {
        if (alive) setState({ data: null, loading: false, error: true });
      });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return state;
}

/**
 * A month's page of journeys as the route answered it.
 *
 * @since 0.31.0
 */
export interface JourneyPage {
  rows: JourneyRow[];
}

const EMPTY_PAGE: JourneyPage = { rows: [] };

/**
 * The journeys of `page` (1 the newest) of `month`, each page fetched once; while a page loads, the last one
 * shown stays, and nothing is fetched for an empty month.
 *
 * @since 0.31.0
 */
export function useJourneyPage(
  month: string,
  page: number,
): JourneyPage & { loading: boolean; error: boolean } {
  const cache = useRef(new Map<string, JourneyPage>());
  const [shown, setShown] = useState<{ key: string; page: JourneyPage }>({
    key: "",
    page: EMPTY_PAGE,
  });
  const [error, setError] = useState(false);
  const key = month ? `${month}:${page}` : "";
  useEffect(() => {
    setError(false);
    if (!key) {
      setShown({ key, page: EMPTY_PAGE });
      return undefined;
    }
    const hit = cache.current.get(key);
    if (hit) {
      setShown({ key, page: hit });
      return undefined;
    }
    let alive = true;
    getJourneyPage(month, page)
      .then((res) => {
        const loaded = { rows: res?.journeys ?? [] };
        cache.current.set(key, loaded);
        if (alive) setShown({ key, page: loaded });
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [key, month, page]);
  return { ...shown.page, loading: shown.key !== key && !error, error };
}
