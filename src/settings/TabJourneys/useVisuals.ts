/*
 * The Journeys tab's figures, fetched once per mount from the visuals route.
 */

/**
 * WordPress dependencies.
 */
import { useEffect, useState } from "@wordpress/element";

/**
 * Internal dependencies.
 */
import { getJourneyVisuals } from "../api";
import type { JourneyVisuals } from "../types";

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
