/*
 * What plugins register in the browser (condition tests, contexts, actions, a history provider,
 * firing listeners), each key paired with a PHP registration that describes it to the builder.
 */

import type { Recovery } from "../recovery/recovery";
import type { Rule, RuleCondition } from "./types";

/** Everything a condition may look at: the built-in contexts plus every registered one. */
export type RuleContext = Record<string, unknown> & {
  page: {
    kind: string;
    id: number;
    title: string;
    dwell: number;
    /** Seconds since the tab was hidden, 0 while it is visible. */
    hidden: number;
    /** Whether the page is a taxonomy archive, so `page_id` and `term_id` can tell a post from a term. */
    taxonomy: boolean;
  };
  journey: {
    current: string;
    pagesViewed: number;
    visitTime: number;
    returned: number;
    kinds: Record<string, number>;
  };
  attention: { state: "page" | "window" | "hidden" };
  /** The visitor's clock, and the hour on the site's clock (-1 when unknown). */
  clock: { hour: number; weekday: number; minute: number; siteHour: number };
  visitor: {
    id: string;
    isNew: boolean;
    loggedIn: boolean;
    device: "desktop" | "tablet" | "mobile";
  };
  site: { name: string };
};

export type ConditionTest = (
  ctx: RuleContext,
  condition: RuleCondition,
) => boolean;
export type ActionRun = (
  ctx: RuleContext,
  params: Record<string, unknown>,
  recovery: Recovery,
  rule: Rule,
) => void | Promise<void>;
export type ContextRead = () => unknown;

export interface Firing {
  rule: string;
  action: string;
  /** Index of the journey step the rule fired on. */
  step: number;
}

export interface HistoryJourney {
  journey: string;
  started_at?: string;
  outcome?: string;
  value?: number;
  /**
   * Extra context the provider knows per journey (ShopSocket: `cart`), merged into the replay's
   * ctx.
   */
  context?: Record<string, unknown>;
}

export interface HistoryProvider {
  /** Journeys for the replay, newest first; the provider decides the window. */
  load(options: { days?: number; limit?: number }): Promise<HistoryJourney[]>;
  /** Whether `outcome` is meaningful on the journeys. */
  outcomes?: boolean;
}

export interface Registry {
  conditions: Map<string, ConditionTest>;
  contexts: Map<string, ContextRead>;
  actions: Map<string, ActionRun>;
  fireHandlers: Set<(firing: Firing, ctx: RuleContext) => void>;
  contextHandlers: Set<() => void>;
  history: HistoryProvider | null;
}

export function createRegistry(): Registry {
  return {
    conditions: new Map(),
    contexts: new Map(),
    actions: new Map(),
    fireHandlers: new Set(),
    contextHandlers: new Set(),
    history: null,
  };
}
