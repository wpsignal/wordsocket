/*
 * The aside beside the builder, over the stored journeys an extension's history provider loads.
 *
 * - "If this moment were on": the rule replayed on every edit through `WPS.rules.replay()`.
 * - "Where it fired": the firings the journeys carry under the rule's id, with what followed.
 */

/**
 * WordPress dependencies.
 */
import { __, _n, sprintf } from "@wordpress/i18n";
import { Fragment, useEffect, useMemo, useState } from "@wordpress/element";
import {
  Badge,
  Card,
  CollapsibleCard,
  Spinner,
  Stack,
  Text,
} from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import type { Rule } from "../../rules/types";
import { duration, parseJourney as stepsOf } from "../TabJourneys/journeys";
import { useRules } from "./context";

interface Sample {
  steps: Array<{ kind: string; id: number; ms: number }>;
  hit: number;
  outcome: string | null;
}

interface Result {
  total: number;
  count: number;
  unanswerable: string[];
  outcomes: Record<string, number> | null;
  samples: Sample[];
}

const SAMPLES = 8;
const DEBOUNCE_MS = 250;

type Event = "returned" | "dismissed" | "clicked";

interface Fired {
  steps: Sample["steps"];
  /** The steps it fired in, each with how far into the step. */
  hits: Map<number, number>;
  events: Event[];
  orders: Array<{ order: number; value: number }>;
  outcome: string | null;
}

interface History {
  shown: number;
  returned: number;
  dismissed: number;
  clicked: number;
  orders: number;
  value: number;
  samples: Fired[];
}

/** The replay of one rule over loaded journeys, for the aside and the list's reach counts. */
export function replayRule(
  rule: Rule,
  journeys: WPSHistoryJourney[],
  withOutcomes: boolean,
): Result | null {
  const api = window.WPS?.rules;
  if (!api) return null;
  const replay = api.replay(rule, journeys);
  let outcomes: Record<string, number> | null = null;
  if (withOutcomes) {
    outcomes = {};
    replay.fired.forEach(({ index }) => {
      const outcome = journeys[index]?.outcome ?? "unknown";
      outcomes![outcome] = (outcomes![outcome] ?? 0) + 1;
    });
  }
  const samples = replay.fired.slice(0, SAMPLES).map(({ index, step }) => ({
    steps: stepsOf(journeys[index]?.journey ?? ""),
    hit: step,
    outcome: withOutcomes ? (journeys[index]?.outcome ?? null) : null,
  }));
  return {
    total: journeys.length,
    count: replay.count,
    unanswerable: replay.unanswerable,
    outcomes,
    samples,
  };
}

/**
 * What the stored journeys say a moment did, by its id whatever its revision: the counts, and the
 * newest firings with the events and the order that followed each.
 *
 * @since 0.31.0
 */
export function firedHistory(
  ruleId: string,
  journeys: WPSHistoryJourney[],
): History {
  const history: History = {
    shown: 0,
    returned: 0,
    dismissed: 0,
    clicked: 0,
    orders: 0,
    value: 0,
    samples: [],
  };
  const orders = new Map<number, number>();
  journeys.forEach((journey) => {
    const mine = (journey.firings ?? []).filter((f) => f.rule === ruleId);
    if (mine.length === 0) return;
    const sample: Fired = {
      steps: stepsOf(journey.journey),
      hits: new Map(),
      events: [],
      orders: [],
      outcome: journey.outcome ?? null,
    };
    mine.forEach((firing) => {
      const kind = firing.kind ?? "fired";
      if (kind !== "fired") {
        history[kind] += 1;
        sample.events.push(kind);
        return;
      }
      history.shown += 1;
      sample.hits.set(firing.step, firing.ms ?? 0);
      if (firing.order && !orders.has(firing.order)) {
        orders.set(firing.order, firing.value ?? 0);
        sample.orders.push({ order: firing.order, value: firing.value ?? 0 });
      }
    });
    if (sample.hits.size > 0 && history.samples.length < SAMPLES)
      history.samples.push(sample);
  });
  history.orders = orders.size;
  history.value = Array.from(orders.values()).reduce((a, b) => a + b, 0);
  return history;
}

/** An amount in the provider's currency, or the bare number when it names none. */
function money(amount: number, currency: string | undefined): string {
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

const EVENT_LABELS: Record<Event, () => string> = {
  returned: () => __("Came back", "wordsocket"),
  dismissed: () => __("Dismissed", "wordsocket"),
  clicked: () => __("Clicked", "wordsocket"),
};

export function ReplayPanel({ rule }: { rule: Rule }) {
  const { kinds, history } = useRules();
  const { provider, journeys, loading, failed } = history;
  const [result, setResult] = useState<Result | null>(null);
  const key = JSON.stringify(rule.conditions);
  useEffect(() => {
    if (!journeys || !provider) return undefined;
    const timer = window.setTimeout(
      () => setResult(replayRule(rule, journeys, Boolean(provider.outcomes))),
      DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- the conditions decide the replay; the actions and name do not. */
  }, [key, journeys, provider]);
  const fired = useMemo(
    () => (journeys ? firedHistory(rule.id, journeys) : null),
    [rule.id, journeys],
  );
  if (!provider) return null;

  const outcomeBadge = (outcome: string | null) =>
    outcome && (
      <Badge
        intent={
          outcome === "converted"
            ? "stable"
            : outcome === "left"
              ? "high"
              : "none"
        }
      >
        {outcome}
      </Badge>
    );
  const trail = (
    steps: Sample["steps"],
    isHit: (i: number) => boolean,
    hitTitle?: (i: number) => string,
  ) =>
    steps.map((step, i) => (
      <Badge
        key={i}
        intent={
          isHit(i) ? "informational" : step.kind === "away" ? "draft" : "none"
        }
        title={
          isHit(i) && hitTitle
            ? hitTitle(i)
            : step.id
              ? `${step.kind} ${step.id}`
              : step.kind
        }
      >
        {`${
          step.kind === "away"
            ? __("Away", "wordsocket")
            : (kinds[step.kind] ?? step.kind)
        } ${duration(step.ms)}`}
      </Badge>
    ));

  return (
    <Card.Root
      className="wpsignal-rule-replay"
      render={<aside aria-live="polite" />}
    >
      <Card.Header>
        <Card.Title>{__("Replay", "wordsocket")}</Card.Title>
      </Card.Header>
      <Card.Content>
        <Stack direction="column" gap="md">
          {loading && <Spinner />}
          {failed && (
            <Text variant="body-sm" className="wpsignal-muted">
              {__("The journeys could not be loaded.", "wordsocket")}
            </Text>
          )}
          {result && (
            <CollapsibleCard.Root>
              <CollapsibleCard.Header>
                <Text variant="heading-sm">
                  {__("If this moment were on", "wordsocket")}
                </Text>
              </CollapsibleCard.Header>
              <CollapsibleCard.Content>
                <Text variant="heading-2xl">{result.count}</Text>
                <Text variant="body-sm" className="wpsignal-muted">
                  {sprintf(
                    /* translators: %d: journeys replayed */
                    _n(
                      "of %d journey in the last 28 days would have had this moment",
                      "of %d journeys in the last 28 days would have had this moment",
                      result.total,
                      "wordsocket",
                    ),
                    result.total,
                  )}
                </Text>
                {result.outcomes && result.count > 0 && (
                  <Text variant="body-sm" className="wpsignal-muted">
                    {Object.entries(result.outcomes)
                      .map(([outcome, n]) => `${outcome} ${n}`)
                      .join(" · ")}
                  </Text>
                )}

                {result.samples.length > 0 ? (
                  <Stack
                    className="wpsignal-replay-samples"
                    direction="column"
                    gap="md"
                  >
                    <Text variant="heading-sm">
                      {__("Where it would have fired", "wordsocket")}
                    </Text>
                    {result.samples.map((sample, n) => (
                      <Stack
                        key={n}
                        direction="row"
                        gap="xs"
                        wrap="wrap"
                        align="center"
                        className="wpsignal-replay-sample"
                      >
                        {trail(sample.steps, (i) => i === sample.hit)}
                        {outcomeBadge(sample.outcome)}
                      </Stack>
                    ))}
                  </Stack>
                ) : (
                  <Text variant="body-sm" className="wpsignal-muted">
                    {__(
                      "No stored journey matched. Loosen a condition or add a group of alternatives.",
                      "wordsocket",
                    )}
                  </Text>
                )}
                {result.unanswerable.length > 0 && (
                  <Text variant="body-sm" className="wpsignal-muted">
                    {sprintf(
                      /* translators: %s: condition keys */
                      __(
                        "Not replayable from a stored journey: %s. Those counted as false.",
                        "wordsocket",
                      ),
                      result.unanswerable.join(", "),
                    )}
                  </Text>
                )}
              </CollapsibleCard.Content>
            </CollapsibleCard.Root>
          )}
          {fired && (
            <CollapsibleCard.Root>
              <CollapsibleCard.Header>
                <Text variant="heading-sm">
                  {__("Where it fired", "wordsocket")}
                </Text>
              </CollapsibleCard.Header>
              <CollapsibleCard.Content>
                {fired.shown === 0 ? (
                  <Text variant="body-sm" className="wpsignal-muted">
                    {__(
                      "Not in the last 28 days, counting earlier versions of this moment.",
                      "wordsocket",
                    )}
                  </Text>
                ) : (
                  <Fragment>
                    <Text variant="body-sm" className="wpsignal-muted">
                      {[
                        /* translators: %d: times the moment showed */
                        sprintf(__("shown %d", "wordsocket"), fired.shown),
                        /* translators: %d: returns to the tab */
                        sprintf(
                          __("came back %d", "wordsocket"),
                          fired.returned,
                        ),
                        /* translators: %d: dismissals */
                        sprintf(
                          __("dismissed %d", "wordsocket"),
                          fired.dismissed,
                        ),
                        /* translators: %d: clicks inside the prompt */
                        sprintf(__("clicked %d", "wordsocket"), fired.clicked),
                        fired.orders > 0
                          ? sprintf(
                              /* translators: 1: orders credited to the moment, 2: their value */
                              _n(
                                "%1$d order, %2$s",
                                "%1$d orders, %2$s",
                                fired.orders,
                                "wordsocket",
                              ),
                              fired.orders,
                              money(fired.value, provider.currency),
                            )
                          : __("no orders yet", "wordsocket"),
                      ].join(" · ")}
                    </Text>
                    <Stack
                      className="wpsignal-replay-samples"
                      direction="column"
                      gap="md"
                    >
                      {fired.samples.map((sample, n) => (
                        <Stack
                          key={n}
                          direction="row"
                          gap="xs"
                          wrap="wrap"
                          align="center"
                          className="wpsignal-replay-sample"
                        >
                          {trail(
                            sample.steps,
                            (i) => sample.hits.has(i),
                            (i) =>
                              sprintf(
                                /* translators: %s: time into the step */
                                __("Fired after %s", "wordsocket"),
                                duration(sample.hits.get(i) ?? 0),
                              ),
                          )}
                          {sample.events.map((event, i) => (
                            <Badge key={i} intent="none">
                              {EVENT_LABELS[event]()}
                            </Badge>
                          ))}
                          {sample.orders.map(({ order, value }) => (
                            <Badge key={order} intent="stable">
                              {sprintf(
                                /* translators: 1: order number, 2: its value */
                                __("Order #%1$d, %2$s", "wordsocket"),
                                order,
                                money(value, provider.currency),
                              )}
                            </Badge>
                          ))}
                          {sample.orders.length === 0 &&
                            outcomeBadge(sample.outcome)}
                        </Stack>
                      ))}
                    </Stack>
                    <Text variant="body-sm" className="wpsignal-muted">
                      {__(
                        "Counting earlier versions of this moment, over the same journeys.",
                        "wordsocket",
                      )}
                    </Text>
                  </Fragment>
                )}
              </CollapsibleCard.Content>
            </CollapsibleCard.Root>
          )}
        </Stack>
      </Card.Content>
    </Card.Root>
  );
}
