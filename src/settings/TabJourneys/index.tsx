/*
 * Journeys tab: the History card (the switch and the retention), and with History on the three visuals over
 * the last 28 days: where journeys go, how the weeks are going, when visitors are here.
 */

/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
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
import { DEFAULT_FILTERS, parseJourneys, type NetworkFilters, type Outcome } from "./journeys";
import { Network } from "./Network";
import { Trends } from "./Trends";
import { Hours } from "./Hours";
import { useVisuals } from "./useVisuals";

const MONTHS_MIN = 1;
const MONTHS_MAX = 36;

/** The History card: the switch, and the months while it is on. */
function HistoryCard() {
  const history = useSettingSwitch("historyEnabled", {
    success: __("Settings saved.", "wordsocket"),
    error: __("Failed to save settings.", "wordsocket"),
  });
  const { journeysRetentionMonths, setSetting } = useSettings();
  const [draft, setDraft] = useState(String(journeysRetentionMonths));
  useEffect(() => setDraft(String(journeysRetentionMonths)), [journeysRetentionMonths]);
  const saveMonths = useTask((months: number) => saveSettings({ journeys_retention_months: months }), {
    success: __("Settings saved.", "wordsocket"),
    error: __("Failed to save settings.", "wordsocket"),
    onSuccess: (res) => setSetting("journeysRetentionMonths", Number(res.journeys_retention_months) || journeysRetentionMonths),
  });
  const commit = () => {
    const months = Math.min(MONTHS_MAX, Math.max(MONTHS_MIN, Number(draft) || MONTHS_MIN));
    setDraft(String(months));
    if (months !== journeysRetentionMonths) void saveMonths.run(months);
  };
  return (
    <CollapsibleCard.Root className="wpsignal-settings-card" defaultOpen>
      <CollapsibleCard.Header>
        <Card.Title>{__("History", "wordsocket")}</Card.Title>
      </CollapsibleCard.Header>
      <CollapsibleCard.Content>
        <Stack direction="column" gap="md">
          <ToggleControl
            label={__("Keep a history of journeys", "wordsocket")}
            help={__(
              "Off: WordSocket keeps nothing of a visit. On: the pages each visitor opens and how long they stay, as page ids and durations under a random browser id, stay in your own database for the months you choose, linked to the account for the visits they were logged in. Nothing leaves your site; WordPress's privacy tools export and erase it. Moments are recorded on the journey they fired in.",
              "wordsocket",
            )}
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
              help={__("Older journeys are deleted once a day.", "wordsocket")}
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
function VisualCard({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
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

/** The three visuals over the loaded figures. */
function Visuals() {
  const { data, loading, error } = useVisuals(true);
  const [filters, setFilters] = useState<NetworkFilters>(filtersFromUrl);
  const journeys = useMemo(() => parseJourneys(data?.journeys ?? []), [data]);
  if (loading) return <Spinner />;
  if (error) {
    return (
      <Text variant="body-sm" className="wpsignal-muted">
        {__("The journeys could not be loaded. Reload the page to try again.", "wordsocket")}
      </Text>
    );
  }
  if (!data || data.total === 0) {
    return (
      <Text variant="body-sm" className="wpsignal-muted">
        {__("No journey in the last 28 days yet. A journey is written for every visit while History is on.", "wordsocket")}
      </Text>
    );
  }
  return (
    <Stack direction="column" gap="lg">
      <VisualCard
        title={__("Where journeys go", "wordsocket")}
        lede={__(
          "Every visit as a path through your pages to how it ended. Find the paths that end well and the ones that leak.",
          "wordsocket",
        )}
      >
        <Network
          journeys={journeys}
          filters={filters}
          onFilters={setFilters}
          total={data.total}
          outcomes={data.outcomes}
          kinds={data.kinds}
        />
      </VisualCard>
      <VisualCard
        title={__("How the weeks are going", "wordsocket")}
        lede={__(
          "Visits and outcomes day by day, with the 7-day average. Act in the week something changes, not a month later.",
          "wordsocket",
        )}
      >
        <Trends days={data.days} journeys={journeys} total={data.total} outcomes={data.outcomes} ref={data.ref} kinds={data.kinds} />
      </VisualCard>
      <VisualCard
        title={__("When visitors are here", "wordsocket")}
        lede={__(
          "The week by hour on your clock.",
          "wordsocket",
        )}
      >
        <Hours
          hours={data.hours}
          weekStart={data.week_start}
          timezone={data.timezone}
          listed={journeys.length}
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
          "A journey is one visit: the pages a visitor opened, with the time on each, and how it ended. The last 28 days are drawn below while History is on.",
          "wordsocket",
        )}
      />
      <HistoryCard />
      {historyEnabled && <Visuals />}
    </Stack>
  );
}
