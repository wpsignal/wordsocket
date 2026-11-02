/*
 * The aside beside the builder, over the stored journeys the history provider loads: three figures
 * with a bar each, and a button to the journeys themselves.
 *
 * - "Would reach": the rule replayed on every edit through `WPS.rules.replay()`, with its outcomes.
 * - "Fires on": the replay's hits by the page kind they land on.
 * - "So far" and "Shown on": what the journeys' firings say the moment did and where, once it has
 *   fired for real.
 */

/**
 * WordPress dependencies.
 */
import { __, _n, sprintf } from "@wordpress/i18n";
import { useEffect, useMemo, useState } from "@wordpress/element";
import { Button, Card, Meter, Spinner, Stack, Text } from "@wordpress/ui";
import type { CSSProperties } from "react";

/**
 * Internal dependencies.
 */
import type { Rule } from "../../rules/types";
import {
  duration,
  kindColor,
  kindLabel,
  outcomeColor,
  outcomeLabel,
  type Kinds,
  type Outcomes,
} from "../TabJourneys/journeys";
import { HelpToolTip } from "../HelpToolTip";
import { useRules } from "./context";
import {
  firedHistory,
  firesOn,
  money,
  outcomeCounts,
  replayRule,
  type KindShare,
  type Replay,
} from "./replay";
import { ReplayJourneys, type ReplayTab } from "./ReplayJourneys";

const DEBOUNCE_MS = 250;
/** Kinds listed under "Fires on" before the rest fold into one row. */
const KIND_ROWS = 5;

interface Part {
  n: number;
  color: string;
  label: string;
}

/** A bar split in proportion to its parts, a 2 px gap between them. */
function Segments({ parts, title }: { parts: Part[]; title: string }) {
  return (
    <div className="wpsignal-replay__seg" role="img" aria-label={title}>
      {parts
        .filter((p) => p.n > 0)
        .map((p) => (
          <i key={p.label} style={{ flex: p.n, background: p.color }} />
        ))}
    </div>
  );
}

/** The parts of a bar as "N label" entries, a swatch before each. */
function Legend({ parts }: { parts: Part[] }) {
  return (
    <Stack
      direction="row"
      gap="md"
      wrap="wrap"
      className="wpsignal-replay__legend"
    >
      {parts
        .filter((p) => p.n > 0)
        .map((p) => (
          <Text
            key={p.label}
            variant="body-sm"
            style={{ "--c": p.color } as CSSProperties}
          >
            <b>{p.n.toLocaleString()}</b> {p.label}
          </Text>
        ))}
    </Stack>
  );
}

function Block({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack direction="column" gap="sm" className="wpsignal-replay__block">
      <Text variant="body-sm" className="wpsignal-replay__label">
        {label}
      </Text>
      {children}
    </Stack>
  );
}

const PERCENT = (n: number, of: number) =>
  of > 0 ? `${Math.round((n / of) * 100)}%` : "0%";

/** The first rows as they are, the rest folded into one unnamed row. */
function fold(rows: KindShare[]): KindShare[] {
  if (rows.length <= KIND_ROWS) return rows;
  const rest = rows.slice(KIND_ROWS - 1);
  const count = rest.reduce((a, r) => a + r.count, 0);
  return [
    ...rows.slice(0, KIND_ROWS - 1),
    {
      kind: "",
      count,
      share: rest.reduce((a, r) => a + r.share, 0),
      meanS: rest.reduce((a, r) => a + r.meanS * r.count, 0) / count,
    },
  ];
}

/** The page kinds the firings land on: a bar of the share and the mean time into the page. */
function KindRows({ rows, kinds }: { rows: KindShare[]; kinds: Kinds }) {
  return (
    <div className="wpsignal-replay__rows">
      {rows.map((row) => (
        <div
          key={row.kind}
          className="wpsignal-replay__row"
          style={{ "--c": kindColor(row.kind) } as CSSProperties}
          title={sprintf(
            /* translators: 1: journeys, 2: time into the page */
            _n(
              "%1$s journey, %2$s into the page on average",
              "%1$s journeys, %2$s into the page on average",
              row.count,
              "wordsocket",
            ),
            row.count.toLocaleString(),
            duration(row.meanS),
          )}
        >
          <Text variant="body-sm" className="wpsignal-replay__kind">
            {row.kind
              ? kindLabel(row.kind, kinds)
              : __("Elsewhere", "wordsocket")}
          </Text>
          <span className="wpsignal-replay__bar">
            <i style={{ width: `${row.share * 100}%` }} />
          </span>
          <Text variant="body-sm" className="wpsignal-replay__share">
            {`${Math.round(row.share * 100)}%`}
          </Text>
          <Text variant="body-sm" className="wpsignal-replay__time">
            {`~${duration(row.meanS)}`}
          </Text>
        </div>
      ))}
    </div>
  );
}

/**
 * The replay aside.
 *
 * @since 0.31.0
 * @since 0.31.0 Three figure blocks and a journeys dialog replace the sample trails (2026-11-01).
 */
export function ReplayPanel({ rule }: { rule: Rule }) {
  const { kinds, history } = useRules();
  const { provider, journeys, loading, failed } = history;
  const outcomes: Outcomes = window.wpsignalSettings?.history?.outcomes ?? {};
  const [result, setResult] = useState<Replay | null>(null);
  const [open, setOpen] = useState<ReplayTab | null>(null);
  const key = JSON.stringify(rule.conditions);
  useEffect(() => {
    if (!journeys || !provider) return undefined;
    const timer = window.setTimeout(
      () => setResult(replayRule(rule, journeys, true)),
      DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- the conditions decide the replay; the actions and name do not. */
  }, [key, journeys, provider]);
  const fired = useMemo(
    () => (journeys ? firedHistory(rule.id, journeys) : null),
    [rule.id, journeys],
  );
  const reachParts = useMemo<Part[]>(
    () =>
      result && provider?.outcomes
        ? Array.from(outcomeCounts(result.hits), ([outcome, n]) => ({
            n,
            color: outcomeColor(outcome, outcomes),
            label: outcomeLabel(outcome, outcomes),
          }))
        : [],
    [result, provider?.outcomes, outcomes],
  );
  const wouldFireOn = useMemo(
    () => fold(firesOn(result?.hits ?? [])),
    [result],
  );
  const shownOn = useMemo(() => fold(firesOn(fired?.hits ?? [])), [fired]);
  if (!provider) return null;

  const fateParts: Part[] = fired
    ? [
        {
          n: fired.fates.returned,
          color: "var(--wpds-color-bg-interactive-brand-strong)",
          label: __("came back", "wordsocket"),
        },
        {
          n: fired.fates.clicked,
          color: "var(--wpds-color-fg-content-success)",
          label: __("clicked", "wordsocket"),
        },
        {
          n: fired.fates.dismissed,
          color: "var(--wpds-color-fg-content-warning)",
          label: __("dismissed", "wordsocket"),
        },
        {
          n: fired.fates.nothing,
          color: "var(--wpds-color-bg-track-neutral)",
          label: __("nothing", "wordsocket"),
        },
      ]
    : [];
  const reached = result?.count ?? 0;
  const shown = fired?.shown ?? 0;

  return (
    <>
      <Card.Root
        className="wpsignal-rule-replay"
        render={<aside aria-live="polite" />}
      >
        <Card.Header className="wpsignal-replay__header">
          <Card.Title>{__("Replay", "wordsocket")}</Card.Title>
          <Text variant="body-sm" className="wpsignal-muted">
            {__("Last 28 days", "wordsocket")}
          </Text>
        </Card.Header>
        <Card.Content>
          <Stack direction="column" gap="xl">
            {loading && <Spinner />}
            {failed && (
              <Text variant="body-sm" className="wpsignal-muted">
                {__("The journeys could not be loaded.", "wordsocket")}
              </Text>
            )}
            {result && (
              <Block label={__("Projections:", "wordsocket")}>
                <Stack
                  direction="row"
                  gap="sm"
                  align="baseline"
                  className="wpsignal-replay__hero"
                >
                  <Text variant="heading-2xl">{reached.toLocaleString()}</Text>
                  <Text variant="body-sm" className="wpsignal-muted">
                    {sprintf(
                      /* translators: %s: journeys replayed */
                      _n(
                        "of %s journey",
                        "of %s journeys",
                        result.total,
                        "wordsocket",
                      ),
                      result.total.toLocaleString(),
                    )}
                  </Text>
                  {result.unanswerable.length > 0 && (
                    <HelpToolTip
                      hint={sprintf(
                        /* translators: %s: condition keys */
                        __(
                          "Not replayable from a stored journey: %s. Those counted as false.",
                          "wordsocket",
                        ),
                        result.unanswerable.join(", "),
                      )}
                    />
                  )}
                  <Text variant="body-sm" className="wpsignal-replay__pct">
                    {PERCENT(reached, result.total)}
                  </Text>
                </Stack>
                <Meter.Root
                  value={reached}
                  max={Math.max(result.total, 1)}
                  aria-label={__("Journeys reached", "wordsocket")}
                >
                  <Meter.Track>
                    <Meter.Indicator tone="brand" />
                  </Meter.Track>
                </Meter.Root>
                {reached === 0 ? (
                  <Text variant="body-sm" className="wpsignal-muted">
                    {result.total === 0
                      ? __("No journeys have been kept yet.", "wordsocket")
                      : __(
                          "No stored journey matched. Loosen a condition or add a group of alternatives.",
                          "wordsocket",
                        )}
                  </Text>
                ) : (
                  reachParts.length > 0 && (
                    <>
                      <Segments
                        parts={reachParts}
                        title={__(
                          "Outcomes of the journeys reached",
                          "wordsocket",
                        )}
                      />
                      <Legend parts={reachParts} />
                    </>
                  )
                )}
              </Block>
            )}
            {wouldFireOn.length > 0 && (
              <Block label={__("Fires on", "wordsocket")}>
                <KindRows rows={wouldFireOn} kinds={kinds} />
              </Block>
            )}
            {fired && shown > 0 && (
              <Block label={__("Conversions:", "wordsocket")}>
                <div className="wpsignal-replay__tiles">
                  <div className="wpsignal-replay__tile">
                    <Text variant="heading-lg">{shown.toLocaleString()}</Text>
                    <Text variant="body-sm" className="wpsignal-muted">
                      {__("shown", "wordsocket")}
                    </Text>
                  </div>
                  <div className="wpsignal-replay__tile">
                    <Text variant="heading-lg">
                      {PERCENT(fired.fates.clicked, shown)}
                    </Text>
                    <Text variant="body-sm" className="wpsignal-muted">
                      {__("clicked", "wordsocket")}
                    </Text>
                  </div>
                  <div className="wpsignal-replay__tile">
                    <Text variant="heading-lg">
                      {fired.orders > 0
                        ? money(fired.value, provider.currency)
                        : "0"}
                    </Text>
                    <Text variant="body-sm" className="wpsignal-muted">
                      {sprintf(
                        /* translators: %d: orders credited to the moment */
                        _n("%d order", "%d orders", fired.orders, "wordsocket"),
                        fired.orders,
                      )}
                    </Text>
                  </div>
                </div>
                <Segments
                  parts={fateParts}
                  title={__("What followed each showing", "wordsocket")}
                />
                <Legend parts={fateParts.slice(0, 3)} />
              </Block>
            )}
            {shownOn.length > 0 && (
              <Block label={__("Shown on", "wordsocket")}>
                <KindRows rows={shownOn} kinds={kinds} />
              </Block>
            )}

            {(reached > 0 || shown > 0) && (
              <Button
                variant="minimal"
                tone="brand"
                size="compact"
                className="wpsignal-replay__open"
                onClick={() => setOpen(reached > 0 ? "reach" : "fired")}
              >
                {reached > 0
                  ? sprintf(
                      /* translators: %s: journeys the moment would reach */
                      _n(
                        "See the %s journey",
                        "See the %s journeys",
                        reached,
                        "wordsocket",
                      ),
                      reached.toLocaleString(),
                    )
                  : __("See where it fired", "wordsocket")}
              </Button>
            )}
          </Stack>
        </Card.Content>
      </Card.Root>
      {open && result && fired && (
        <ReplayJourneys
          tab={open}
          reach={result.hits}
          fired={fired.hits}
          kinds={kinds}
          outcomes={outcomes}
          currency={provider.currency}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
