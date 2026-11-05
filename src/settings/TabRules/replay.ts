/*
 * The replay's figures over the stored journeys a history provider loaded.
 *
 * - `replayRule()`: the rule run through `WPS.rules.replay()`, with the journeys it would reach.
 * - `firedHistory()`: what the journeys' firings say the rule did, by its id whatever the revision.
 * - `firesOn()`, `fates()`: the aggregates the aside draws from either.
 */

/**
 * Internal dependencies.
 */
import type { Rule } from "../../rules/types";
import { parseJourney, type Step } from "../TabJourneys/journeys";

/**
 * What a visitor did with a prompt after it fired.
 *
 * @since 0.31.0
 */
export type Event = "returned" | "dismissed" | "clicked";

/**
 * One journey the rule would reach or did fire in.
 *
 * @since 0.31.0
 */
export interface Hit {
  steps: Step[];
  /** Step index to seconds into it: one entry for a replay, one per firing for history. */
  hits: Map<number, number>;
  outcome: string | null;
  value: number;
  startedAt: string | null;
  events: Event[];
  orders: Array<{ order: number; value: number }>;
}

/**
 * The rule replayed over the journeys.
 *
 * @since 0.31.0 Lists the journeys reached as `hits` instead of eight samples.
 */
export interface Replay {
  total: number;
  count: number;
  unanswerable: string[];
  hits: Hit[];
}

/**
 * A shown prompt's strongest fate: clicked over dismissed over came back over nothing.
 *
 * @since 0.31.0
 */
export interface Fates {
  clicked: number;
  dismissed: number;
  returned: number;
  nothing: number;
}

/**
 * What the stored journeys say the rule did.
 *
 * @since 0.31.0
 */
export interface History {
  shown: number;
  fates: Fates;
  orders: number;
  value: number;
  hits: Hit[];
}

/**
 * A page kind's share of the firings and the mean seconds into the step.
 *
 * @since 0.31.0
 */
export interface KindShare {
  kind: string;
  count: number;
  share: number;
  meanS: number;
}

/**
 * The replay of one rule over loaded journeys: the count alone for the list, the journeys reached
 * as well when `detailed`.
 *
 * @since 0.31.0
 */
export function replayRule(
  rule: Rule,
  journeys: WPSHistoryJourney[],
  detailed: boolean,
): Replay | null {
  const api = window.WPS?.rules;
  if (!api) return null;
  const replay = api.replay(rule, journeys);
  const hits = detailed
    ? replay.fired.map(({ index, step }) => {
        const journey = journeys[index];
        const steps = parseJourney(journey?.journey ?? "");
        return {
          steps,
          hits: new Map([[step, steps[step]?.s ?? 0]]),
          outcome: journey?.outcome ?? null,
          value: journey?.value ?? 0,
          startedAt: journey?.started_at ?? null,
          events: [],
          orders: [],
        } satisfies Hit;
      })
    : [];
  return {
    total: journeys.length,
    count: replay.count,
    unanswerable: replay.unanswerable,
    hits,
  };
}

/**
 * What the stored journeys say a moment did, by its id whatever its revision.
 *
 * @since 0.31.0
 */
export function firedHistory(
  ruleId: string,
  journeys: WPSHistoryJourney[],
): History {
  const history: History = {
    shown: 0,
    fates: { clicked: 0, dismissed: 0, returned: 0, nothing: 0 },
    orders: 0,
    value: 0,
    hits: [],
  };
  const orders = new Map<number, number>();
  journeys.forEach((journey) => {
    const mine = (journey.firings ?? []).filter((f) => f.rule === ruleId);
    if (mine.length === 0) return;
    const hit: Hit = {
      steps: parseJourney(journey.journey),
      hits: new Map(),
      outcome: journey.outcome ?? null,
      value: journey.value ?? 0,
      startedAt: journey.started_at ?? null,
      events: [],
      orders: [],
    };
    let shown = 0;
    const seen = { clicked: 0, dismissed: 0, returned: 0 };
    mine.forEach((firing) => {
      const kind = firing.kind ?? "fired";
      if (kind !== "fired") {
        seen[kind] += 1;
        hit.events.push(kind);
        return;
      }
      shown += 1;
      hit.hits.set(firing.step, firing.s ?? 0);
      if (firing.order && !orders.has(firing.order)) {
        orders.set(firing.order, firing.value ?? 0);
        hit.orders.push({ order: firing.order, value: firing.value ?? 0 });
      }
    });
    if (shown === 0) return;
    history.shown += shown;
    let left = shown;
    (["clicked", "dismissed", "returned"] as const).forEach((fate) => {
      const n = Math.min(left, seen[fate]);
      history.fates[fate] += n;
      left -= n;
    });
    history.fates.nothing += left;
    history.hits.push(hit);
  });
  history.orders = orders.size;
  history.value = Array.from(orders.values()).reduce((a, b) => a + b, 0);
  return history;
}

/**
 * The firings grouped by the kind of the step they landed on, largest share first.
 *
 * @since 0.31.0
 */
export function firesOn(hits: Hit[]): KindShare[] {
  const byKind = new Map<string, { count: number; seconds: number }>();
  let total = 0;
  hits.forEach((hit) => {
    hit.hits.forEach((s, step) => {
      const kind = hit.steps[step]?.kind ?? "other";
      const entry = byKind.get(kind) ?? { count: 0, seconds: 0 };
      entry.count += 1;
      entry.seconds += s;
      byKind.set(kind, entry);
      total += 1;
    });
  });
  return Array.from(byKind, ([kind, { count, seconds }]) => ({
    kind,
    count,
    share: total ? count / total : 0,
    meanS: count ? seconds / count : 0,
  })).sort((a, b) => b.count - a.count);
}

/**
 * The journeys counted by outcome, in the order first met.
 *
 * @since 0.31.0
 */
export function outcomeCounts(hits: Hit[]): Map<string, number> {
  const counts = new Map<string, number>();
  hits.forEach((hit) => {
    const key = hit.outcome ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
}

/**
 * An amount in the provider's currency, or the bare number when it names none.
 *
 * @since 0.31.0
 */
export function money(amount: number, currency: string | undefined): string {
  if (!currency) return amount.toLocaleString();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return amount.toLocaleString();
  }
}
