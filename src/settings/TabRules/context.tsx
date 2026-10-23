/*
 * The Rules tab's reference data (vocabulary, page kinds, synced patterns, stored journeys), loaded
 * once and read anywhere below. The rule being edited stays local state, so a keystroke re-renders
 * one row.
 */

/**
 * WordPress dependencies.
 */
import { createContext, useContext } from "@wordpress/element";

/**
 * Internal dependencies.
 */
import type { Vocabulary } from "./model";
import type { PatternOption } from "./ValueControl";
import type { Journeys } from "./useJourneys";

export interface RulesData {
  vocabulary: Vocabulary;
  kinds: Record<string, string>;
  patterns: PatternOption[];
  history: Journeys;
}

const RulesContext = createContext<RulesData | null>(null);

export const RulesProvider = RulesContext.Provider;

/** The tab's reference data; throws outside the provider, which is a bug, not a state. */
export function useRules(): RulesData {
  const data = useContext(RulesContext);
  if (!data) throw new Error("useRules() needs a RulesProvider above it.");
  return data;
}
