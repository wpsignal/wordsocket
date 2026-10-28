/*
 * The Journeys tab's figures, fetched once per mount from the visuals route, and the network's pages of
 * journeys after the first, each fetched once.
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
  const [state, setState] = useState<VisualsState>({ data: null, loading: enabled, error: false });
  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, error: false });
      return undefined;
    }
    let alive = true;
    setState({ data: null, loading: true, error: false });
    getJourneyVisuals()
      .then((data) => {
        if (alive) setState({ data: data ?? null, loading: false, error: false });
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
 * The journeys of `page`, 1 the newest, the visuals' own list for the first; while another page loads, the
 * last one shown stays.
 *
 * @since 0.31.0
 */
export function useJourneyPage(
  page: number,
  first: JourneyRow[],
): { rows: JourneyRow[]; page: number; loading: boolean; error: boolean } {
  const cache = useRef(new Map<number, JourneyRow[]>());
  const [shown, setShown] = useState({ rows: first, page: 1 });
  const [error, setError] = useState(false);
  useEffect(() => {
    const hit = page === 1 ? first : cache.current.get(page);
    setError(false);
    if (hit) {
      setShown({ rows: hit, page });
      return undefined;
    }
    let alive = true;
    getJourneyPage(page)
      .then((res) => {
        const rows = res.journeys ?? [];
        cache.current.set(page, rows);
        if (alive) setShown({ rows, page });
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [page, first]);
  return { ...shown, loading: shown.page !== page && !error, error };
}
