/*
 * Journeys tab: the History card (the switch and the retention), and with History on the three visuals over
 * the last 28 days: where journeys go, how the weeks are going, when visitors are here.
 */

/**
 * WordPress dependencies.
 */
import { __, sprintf } from "@wordpress/i18n";
import { useEffect, useMemo, useState } from "@wordpress/element";
import { TextControl, ToggleControl } from "@wordpress/components";
import { Card, CollapsibleCard, Spinner, Stack, Text } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { TabHeading } from "../TabHeading";
import { saveSettings } from "../api";
import { useSettings } from "../context";
import { useSettingSwitch } from "../TabSettings/useSettingSwitch";
import { useTask } from "../useTask";
import { readUrlParam } from "../useUrlParam";
import {
  DEFAULT_FILTERS,
  parseJourneys,
  type NetworkFilters,
  type Outcome,
  type VisualJourney,
} from "./journeys";
import { Network } from "./Network";
import { dayIn } from "./chart";
import { Trends } from "./Trends";
import { Hours } from "./Hours";
import { useJourneyPage, useVisuals } from "./useVisuals";

const MONTHS_MIN = 1;
/** Journeys to a page of the network, as `Journeys::VISUALS_JOURNEYS` lists them. */
const PAGE_SIZE = 1000;
const MONTHS_MAX = 36;

/** The History card: the switch, and the months while it is on. */
function HistoryCard() {
  const history = useSettingSwitch("historyEnabled", {
    success: __("Settings saved.", "wordsocket"),
    error: __("Failed to save settings.", "wordsocket"),
  });
  const { journeysRetentionMonths, setSetting } = useSettings();
  const [draft, setDraft] = useState(String(journeysRetentionMonths));
  useEffect(
    () => setDraft(String(journeysRetentionMonths)),
    [journeysRetentionMonths],
  );
  const saveMonths = useTask(
    (months: number) => saveSettings({ journeys_retention_months: months }),
    {
      success: __("Settings saved.", "wordsocket"),
      error: __("Failed to save settings.", "wordsocket"),
      onSuccess: (res) =>
        setSetting(
          "journeysRetentionMonths",
          Number(res.journeys_retention_months) || journeysRetentionMonths,
        ),
    },
  );
  const commit = () => {
    const months = Math.min(
      MONTHS_MAX,
      Math.max(MONTHS_MIN, Number(draft) || MONTHS_MIN),
    );
    setDraft(String(months));
    if (months !== journeysRetentionMonths) void saveMonths.run(months);
  };
  return (
    <CollapsibleCard.Root className="wpsignal-settings-card" defaultOpen>
      <CollapsibleCard.Header>
        <Card.Title>{__("History", "wordsocket")}</Card.Title>
      </CollapsibleCard.Header>
      <CollapsibleCard.Content>
        <Stack direction="column" gap="lg">
          <Text variant="body-sm" className="wpsignal-muted" render={<p />}>
            {__(
              "See how people move through your site: the pages they look at, how long they stay and where they leave. Visits are stored in your own site's database and deleted after the months you choose.",
              "wordsocket",
            )}
          </Text>
          <ToggleControl
            label={__("Keep a history of journeys", "wordsocket")}
            checked={history.checked}
            disabled={history.isPending}
            onChange={history.change}
            __nextHasNoMarginBottom
          />
          {history.checked && (
            <TextControl
              type="number"
              min={MONTHS_MIN}
              max={MONTHS_MAX}
              label={__("Keep journeys for (months)", "wordsocket")}
              help={__(
                "Older journeys are deleted automatically.",
                "wordsocket",
              )}
              value={draft}
              onChange={setDraft}
              onBlur={commit}
              onKeyDown={(evt: React.KeyboardEvent) => {
                if (evt.key === "Enter") commit();
              }}
              disabled={saveMonths.isPending}
              __nextHasNoMarginBottom
              __next40pxDefaultSize
            />
          )}
        </Stack>
      </CollapsibleCard.Content>
    </CollapsibleCard.Root>
  );
}

/** One visual in its card: a title, the one sentence on what it is for, the chart. */
function VisualCard({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <Card.Root className="wpsignal-visual">
      <Card.Header>
        <Card.Title>{title}</Card.Title>
      </Card.Header>
      <Card.Content>
        <Stack direction="column" gap="md">
          <Text variant="body-sm" className="wpsignal-muted" render={<p />}>
            {lede}
          </Text>
          {children}
        </Stack>
      </Card.Content>
    </Card.Root>
  );
}

/** The network's filters from the URL (`&outcome=left&through=product&min=2&pages=2`), as a link into the tab sets them. */
function filtersFromUrl(): NetworkFilters {
  return {
    outcome: (readUrlParam("outcome") ?? "") as Outcome | "",
    through: readUrlParam("through") ?? "",
    min: Number(readUrlParam("min")) || DEFAULT_FILTERS.min,
    pages: Number(readUrlParam("pages")) || DEFAULT_FILTERS.pages,
  };
}

/** The days a page of journeys spans on the site's clock, oldest first, as "21 Oct to 27 Oct". */
function rangeOf(journeys: VisualJourney[], timezone: string): string {
  if (!journeys.length) return "";
  const newest = dayIn(journeys[0].startedAt, timezone);
  const oldest = dayIn(journeys[journeys.length - 1].startedAt, timezone);
  if (!newest || !oldest) return "";
  if (newest === oldest) return newest;
  /* translators: 1: the oldest day, 2: the newest day */
  return sprintf(__("%1$s to %2$s", "wordsocket"), oldest, newest);
}

/** The three visuals over the loaded figures. */
function Visuals() {
  const { data, loading, error } = useVisuals(true);
  const [filters, setFilters] = useState<NetworkFilters>(filtersFromUrl);
  const [chosen, setChosen] = useState({ month: "", page: 1 });
  /* The newest month with journeys until one is chosen. */
  const month = chosen.month || data?.months[0]?.month || "";
  const paged = useJourneyPage(month, chosen.page);
  const pageJourneys = useMemo(() => parseJourneys(paged.rows), [paged.rows]);
  if (loading) return <Spinner />;
  if (error) {
    return (
      <Text variant="body-sm" className="wpsignal-muted">
        {__(
          "The journeys couldn't be loaded. Reload the page to try again.",
          "wordsocket",
        )}
      </Text>
    );
  }
  if (!data || data.months.length === 0) {
    return (
      <Text variant="body-sm" className="wpsignal-muted">
        {__(
          "No journeys yet. They appear here as people visit your site.",
          "wordsocket",
        )}
      </Text>
    );
  }
  return (
    <Stack direction="column" gap="lg">
      <VisualCard
        title={__("Where journeys go", "wordsocket")}
        lede={__(
          "Each line is one visit, from the first page to how it ended. Spot the routes that end well and the pages where people drop off.",
          "wordsocket",
        )}
      >
        <Network
          journeys={pageJourneys}
          filters={filters}
          onFilters={setFilters}
          pager={{
            month,
            months: data.months,
            page: chosen.page,
            size: PAGE_SIZE,
            total: data.months.find((m) => m.month === month)?.count ?? 0,
            range: rangeOf(pageJourneys, data.timezone),
            loading: paged.loading,
            error: paged.error,
            onMonth: (next) => setChosen({ month: next, page: 1 }),
            onPage: (page) => setChosen({ month, page }),
          }}
          outcomes={data.outcomes}
          kinds={data.kinds}
        />
      </VisualCard>
      <VisualCard
        title={__("How the weeks are going", "wordsocket")}
        lede={__(
          "Visits and how they ended, day by day, with a weekly average, so you notice a change the week it happens.",
          "wordsocket",
        )}
      >
        <Trends days={data.days} outcomes={data.outcomes} refInfo={data.ref} />
      </VisualCard>
      <VisualCard
        title={__("When visitors are here", "wordsocket")}
        lede={__(
          "Your busiest days and hours, in your site's time zone.",
          "wordsocket",
        )}
      >
        <Hours
          hours={data.hours}
          weekStart={data.week_start}
          timezone={data.timezone}
          listed={data.listed}
          total={data.total}
          outcomes={data.outcomes}
        />
      </VisualCard>
    </Stack>
  );
}

/**
 * The tab.
 *
 * @since 0.31.0
 */
export function TabJourneys({ title }: { title: string }) {
  const { historyEnabled } = useSettings();
  return (
    <Stack direction="column" gap="lg">
      <TabHeading
        title={title}
        help={__(
          "A journey is one visit to your site: the pages someone looked at, how long they stayed on each, and how the visit ended. With History on, the journeys are drawn below a month at a time, and the weeks and hours over the last four weeks.",
          "wordsocket",
        )}
      />
      <HistoryCard />
      {historyEnabled && <Visuals />}
    </Stack>
  );
}
