/*
 * "Would this rule have fired?" beside the builder, replayed over the stored journeys on every edit
 * through `WPS.rules.replay()`. Exists only when an extension registered a history provider.
 */

/**
 * WordPress dependencies.
 */
import { __, _n, sprintf } from "@wordpress/i18n";
import { Fragment, useEffect, useState } from "@wordpress/element";
import { Badge, Card, Spinner, Stack, Text } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import type { Rule } from "../../rules/types";
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

/**
 * The stored journey as steps; the engine's parser is private, so the same split lives here.
 */
function stepsOf(journey: string): Sample["steps"] {
  if (!journey) return [];
  return journey.split(">").map((s) => {
    const [kind, id, ms] = s.split(":");
    return { kind, id: Number(id) || 0, ms: Number(ms) || 0 };
  });
}

function duration(ms: number): string {
  if (ms >= 60_000) {
    /* translators: %d: minutes */
    return sprintf(__("%d min", "wordsocket"), Math.round(ms / 60_000));
  }
  /* translators: %d: seconds */
  return sprintf(__("%d s", "wordsocket"), Math.round(ms / 1000));
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
  if (!provider) return null;

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
            <Fragment>
              <Text variant="heading-2xl">{result.count}</Text>
              <Text variant="body-sm" className="wpsignal-muted">
                {sprintf(
                  /* translators: %d: journeys replayed */
                  _n(
                    "of %d journey in the last 30 days would have had this moment",
                    "of %d journeys in the last 30 days would have had this moment",
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
                      {sample.steps.map((step, i) => (
                        <Badge
                          key={i}
                          intent={
                            i === sample.hit
                              ? "informational"
                              : step.kind === "away"
                                ? "draft"
                                : "none"
                          }
                          title={
                            step.id ? `${step.kind} ${step.id}` : step.kind
                          }
                        >
                          {`${
                            step.kind === "away"
                              ? __("Away", "wordsocket")
                              : (kinds[step.kind] ?? step.kind)
                          } ${duration(step.ms)}`}
                        </Badge>
                      ))}
                      {sample.outcome && (
                        <Badge
                          intent={
                            sample.outcome === "converted"
                              ? "stable"
                              : sample.outcome === "left"
                                ? "high"
                                : "none"
                          }
                        >
                          {sample.outcome}
                        </Badge>
                      )}
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
            </Fragment>
          )}
        </Stack>
      </Card.Content>
    </Card.Root>
  );
}
