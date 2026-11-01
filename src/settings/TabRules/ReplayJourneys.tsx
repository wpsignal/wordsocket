/*
 * The replay's journeys in a dialog: the ones the moment would reach and the ones it fired in, one
 * row each with the trail as a strip where width is time, filtered by outcome and by the page the
 * moment lands on, 25 at a time.
 */

/**
 * WordPress dependencies.
 */
import { __, _n, sprintf } from "@wordpress/i18n";
import { Fragment, useMemo, useState } from "@wordpress/element";
import { Badge, Button, Dialog, Stack, Tabs, Text } from "@wordpress/ui";
import type { CSSProperties } from "react";

/**
 * Internal dependencies.
 */
import {
  duration,
  kindColor,
  kindLabel,
  orderKinds,
  outcomeColor,
  outcomeLabel,
  type Kinds,
  type Outcomes,
} from "../TabJourneys/journeys";
import { money, outcomeCounts, type Event, type Hit } from "./replay";

export type ReplayTab = "reach" | "fired";

const PAGE = 25;

const EVENT_LABELS: Record<Event, () => string> = {
  returned: () => __("came back", "wordsocket"),
  dismissed: () => __("dismissed", "wordsocket"),
  clicked: () => __("clicked", "wordsocket"),
};

const WHEN = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

function when(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? "" : WHEN.format(new Date(t));
}

function badgeIntent(outcome: string) {
  return outcome === "converted"
    ? "stable"
    : outcome === "left"
    ? "high"
    : "none";
}

/** A filter chip: a swatch and a label, pressed when it is the one applied. */
function Chip({
  on,
  color,
  label,
  onClick,
}: {
  on: boolean;
  color?: string;
  label: string;
  onClick(): void;
}) {
  return (
    <Button
      variant={on ? "solid" : "outline"}
      tone="neutral"
      size="small"
      aria-pressed={on}
      onClick={onClick}
    >
      {color && (
        <span
          className="wpsignal-replay__dot"
          style={{ background: color }}
          aria-hidden="true"
        />
      )}
      {label}
    </Button>
  );
}

/** One journey: when, the strip with the firing marked, the steps in words, the outcome. */
function JourneyRow({
  hit,
  kinds,
  outcomes,
  currency,
  fired,
}: {
  hit: Hit;
  kinds: Kinds;
  outcomes: Outcomes;
  currency: string | undefined;
  fired: boolean;
}) {
  const total = hit.steps.reduce((a, s) => a + s.s, 0);
  const pages = hit.steps.filter((s) => s.kind !== "away").length;
  const at = (i: number, step: Hit["steps"][number]) => {
    const s = hit.hits.get(i);
    if (s === undefined) return undefined;
    return `${Math.min(100, step.s > 0 ? (s / step.s) * 100 : 0)}%`;
  };
  const fireWords = (i: number) =>
    fired
      ? sprintf(
          /* translators: %s: time into the page */
          __("fired after %s", "wordsocket"),
          duration(hit.hits.get(i) ?? 0),
        )
      : __("fires here", "wordsocket");
  return (
    <div className="wpsignal-replay-journey">
      <div className="wpsignal-replay-journey__when">
        <Text variant="body-sm">{when(hit.startedAt)}</Text>
        <Text variant="body-sm" className="wpsignal-muted">
          {`${duration(total)} · ${sprintf(
            /* translators: %d: pages in the journey */
            _n("%d page", "%d pages", pages, "wordsocket"),
            pages,
          )}`}
        </Text>
      </div>
      <div className="wpsignal-replay-journey__trail">
        <div className="wpsignal-replay-strip" aria-hidden="true">
          {hit.steps.map((step, i) => (
            <i
              key={i}
              className={
                (step.kind === "away" ? "is-away" : "") +
                (hit.hits.has(i) ? " is-hit" : "")
              }
              style={
                {
                  flex: Math.max(step.s, 1),
                  "--c": kindColor(step.kind),
                  "--at": at(i, step),
                } as CSSProperties
              }
              title={`${kindLabel(step.kind, kinds)} ${duration(step.s)}${
                hit.hits.has(i) ? `, ${fireWords(i)}` : ""
              }`}
            />
          ))}
        </div>
        <Text variant="body-sm" className="wpsignal-replay-journey__crumbs">
          {hit.steps.map((step, i) => (
            <Fragment key={i}>
              {i > 0 && " › "}
              {hit.hits.has(i) ? (
                <mark>
                  {`${kindLabel(step.kind, kinds)} ${duration(
                    step.s,
                  )}, ${fireWords(i)}`}
                </mark>
              ) : (
                `${kindLabel(step.kind, kinds)} ${duration(step.s)}`
              )}
            </Fragment>
          ))}
        </Text>
      </div>
      <div className="wpsignal-replay-journey__end">
        {hit.orders.length > 0
          ? hit.orders.map(({ order, value }) => (
              <Badge key={order} intent="stable">
                {sprintf(
                  /* translators: 1: order number, 2: its value */
                  __("Order #%1$d, %2$s", "wordsocket"),
                  order,
                  money(value, currency),
                )}
              </Badge>
            ))
          : hit.outcome && (
              <Badge intent={badgeIntent(hit.outcome)}>
                {hit.value > 0
                  ? `${outcomeLabel(hit.outcome, outcomes)}, ${money(
                      hit.value,
                      currency,
                    )}`
                  : outcomeLabel(hit.outcome, outcomes)}
              </Badge>
            )}
        {hit.events.length > 0 && (
          <Text variant="body-sm" className="wpsignal-muted">
            {Array.from(new Set(hit.events), (e) => EVENT_LABELS[e]()).join(
              " · ",
            )}
          </Text>
        )}
      </div>
    </div>
  );
}

/** One tab's journeys with its filters and pager. */
function JourneyList({
  hits,
  kinds,
  outcomes,
  currency,
  fired,
}: {
  hits: Hit[];
  kinds: Kinds;
  outcomes: Outcomes;
  currency: string | undefined;
  fired: boolean;
}) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const counts = useMemo(() => outcomeCounts(hits), [hits]);
  const landing = (hit: Hit) =>
    Array.from(hit.hits.keys(), (i) => hit.steps[i]?.kind ?? "other");
  const kindKeys = useMemo(() => orderKinds(hits.flatMap(landing)), [hits]);
  const rows = hits.filter(
    (hit) =>
      (outcome === null || (hit.outcome ?? "unknown") === outcome) &&
      (kind === null || landing(hit).includes(kind)),
  );
  const listed = rows.slice(0, limit);
  if (hits.length === 0)
    return (
      <Text variant="body-sm" className="wpsignal-muted">
        {fired
          ? __("This moment has not fired in the last 28 days.", "wordsocket")
          : __("No stored journey matched.", "wordsocket")}
      </Text>
    );
  return (
    <Stack direction="column" gap="md">
      <Stack
        direction="row"
        gap="xs"
        wrap="wrap"
        align="center"
        className="wpsignal-replay-dialog__filters"
      >
        <Chip
          on={outcome === null}
          label={__("All", "wordsocket")}
          onClick={() => setOutcome(null)}
        />
        {Array.from(counts, ([key, n]) => (
          <Chip
            key={key}
            on={outcome === key}
            color={outcomeColor(key, outcomes)}
            label={`${outcomeLabel(key, outcomes)} ${n.toLocaleString()}`}
            onClick={() => setOutcome(outcome === key ? null : key)}
          />
        ))}
        {kindKeys.length > 1 && (
          <>
            <span className="wpsignal-replay-dialog__spacer" />
            {kindKeys.map((key) => (
              <Chip
                key={key}
                on={kind === key}
                color={kindColor(key)}
                label={sprintf(
                  /* translators: %s: a page kind */
                  __("On %s", "wordsocket"),
                  kindLabel(key, kinds),
                )}
                onClick={() => setKind(kind === key ? null : key)}
              />
            ))}
          </>
        )}
      </Stack>
      <div className="wpsignal-replay-dialog__list">
        {listed.map((hit, i) => (
          <JourneyRow
            key={i}
            hit={hit}
            kinds={kinds}
            outcomes={outcomes}
            currency={currency}
            fired={fired}
          />
        ))}
      </div>
      <Stack direction="row" gap="md" align="center" justify="center">
        <Text variant="body-sm" className="wpsignal-muted">
          {sprintf(
            /* translators: 1: rows listed, 2: rows in all */
            __("%1$s of %2$s", "wordsocket"),
            listed.length.toLocaleString(),
            rows.length.toLocaleString(),
          )}
        </Text>
        {listed.length < rows.length && (
          <Button
            variant="minimal"
            tone="brand"
            size="compact"
            onClick={() => setLimit(limit + PAGE)}
          >
            {sprintf(
              /* translators: %d: rows added per click */
              __("Show %d more", "wordsocket"),
              PAGE,
            )}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

/**
 * The journeys behind the replay aside's figures, in a dialog.
 *
 * @since 0.31.0
 */
export function ReplayJourneys({
  tab,
  reach,
  fired,
  kinds,
  outcomes,
  currency,
  onClose,
}: {
  tab: ReplayTab;
  reach: Hit[];
  fired: Hit[];
  kinds: Kinds;
  outcomes: Outcomes;
  currency: string | undefined;
  onClose(): void;
}) {
  const [current, setCurrent] = useState<ReplayTab>(tab);
  return (
    <Dialog.Root
      open
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Popup className="wpsignal-replay-dialog">
        <Dialog.Header>
          <Dialog.Title>{__("Journeys", "wordsocket")}</Dialog.Title>
          <Dialog.CloseIconButton />
        </Dialog.Header>
        <Dialog.Content>
          <Tabs.Root
            value={current}
            onValueChange={(value: ReplayTab) => setCurrent(value)}
            className="wpsignal-replay-dialog__tabs"
          >
            <Tabs.List variant="minimal">
              <Tabs.Tab value="reach">
                {sprintf(
                  /* translators: %s: journeys the moment would reach */
                  __("Would reach %s", "wordsocket"),
                  reach.length.toLocaleString(),
                )}
              </Tabs.Tab>
              <Tabs.Tab value="fired">
                {sprintf(
                  /* translators: %s: journeys the moment fired in */
                  __("Fired %s", "wordsocket"),
                  fired.length.toLocaleString(),
                )}
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="reach" tabIndex={-1}>
              <JourneyList
                hits={reach}
                kinds={kinds}
                outcomes={outcomes}
                currency={currency}
                fired={false}
              />
            </Tabs.Panel>
            <Tabs.Panel value="fired" tabIndex={-1}>
              <JourneyList
                hits={fired}
                kinds={kinds}
                outcomes={outcomes}
                currency={currency}
                fired
              />
            </Tabs.Panel>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
