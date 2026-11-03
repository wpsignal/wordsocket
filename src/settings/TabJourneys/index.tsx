/*
 * Journeys tab: the History card (the switch and the retention), and with History on the three visuals over
 * the last 28 days: where journeys go, how the weeks are going, when visitors are here.
 */

/**
 * WordPress dependencies.
 */
import { __, _n, sprintf } from "@wordpress/i18n";
import { useEffect, useMemo, useState } from "@wordpress/element";
import {
  Button,
  Icon,
  RangeControl,
  SelectControl,
  TextControl,
  ToggleControl,
} from "@wordpress/components";
import { AlertDialog, Card, Notice, Spinner, Stack, Text } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { TabHeading } from "../TabHeading";
import { purgeJourneys, saveSettings } from "../api";
import { useSettings } from "../context";
import { useSettingSwitch } from "../TabSettings/useSettingSwitch";
import { useTask } from "../useTask";
import { readUrlParam } from "../useUrlParam";
import CollapsibleCard from "../CollapsibleCard";
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
import { useJourneyPage, useVisuals, type VisualsState } from "./useVisuals";
import type { JourneyVisuals } from "../types";
import { chartBar, download, trash } from "@wordpress/icons";

const MONTHS_MIN = 1;
/** Journeys to a page of the network, as `Journeys::VISUALS_JOURNEYS` lists them. */
const PAGE_SIZE = 1000;
const MONTHS_MAX = 12;
/** The months the retention slider labels. */
const MONTH_MARKS = [1, 3, 6, 9, 12].map((value) => ({
  value,
  label: String(value),
}));
/** How long the slider rests before its months are saved. */
const SETTLE_MS = 600;

const DOWNLOAD_DAYS_MAX = 365;

/** Download the last days of journeys as CSV or JSON, for a spreadsheet or an AI assistant without a connector. */
function DownloadJourneys() {
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [days, setDays] = useState("28");
  const base = window.wpsignalSettings?.history?.downloadUrl;
  if (!base) return null;
  const url = new URL(base, window.location.origin);
  url.searchParams.set("format", format);
  url.searchParams.set(
    "days",
    String(
      Math.min(DOWNLOAD_DAYS_MAX, Math.max(1, Math.round(Number(days)) || 1)),
    ),
  );
  return (
    <CollapsibleCard
      title={__("Download journeys", "wordsocket")}
      icon={<Icon icon={download} />}
      defaultOpen={false}
    >
      <Stack direction="column" gap="sm">
        <Text variant="body-sm" className="wpsignal-muted">
          {__(
            "Download the journeys using the format and number of days. Downloads can be used to feed into an AI assistant or a spreadsheet.",
            "wordsocket",
          )}
        </Text>

        <Stack direction="row" gap="md" wrap="wrap" align="end">
          <SelectControl
            label={__("Format", "wordsocket")}
            value={format}
            options={[
              { label: "CSV", value: "csv" },
              { label: "JSON", value: "json" },
            ]}
            onChange={(value: string) =>
              setFormat(value === "json" ? "json" : "csv")
            }
          />
          <TextControl
            type="number"
            min={1}
            max={DOWNLOAD_DAYS_MAX}
            label={__("Days", "wordsocket")}
            value={days}
            onChange={setDays}
            __next40pxDefaultSize
          />
          <Button variant="secondary" href={url.toString()} download>
            {__("Download journeys", "wordsocket")}
          </Button>
        </Stack>
      </Stack>
    </CollapsibleCard>
  );
}

/** Delete journeys, every one or those started between two days, behind a confirmation. */
function PurgeJourneys({ onPurged }: { onPurged(): void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [asking, setAsking] = useState(false);
  const purge = useTask(
    () => purgeJourneys({ from: from || undefined, to: to || undefined }),
    {
      success: (res) =>
        sprintf(
          /* translators: %s: journeys deleted */
          _n(
            "Deleted %s journey.",
            "Deleted %s journeys.",
            res.deleted,
            "wordsocket",
          ),
          res.deleted.toLocaleString(),
        ),
      error: __("The journeys could not be deleted.", "wordsocket"),
      onSuccess: onPurged,
    },
  );
  const inverted = from !== "" && to !== "" && from > to;
  const scope =
    from && to
      ? sprintf(
          /* translators: 1: first day, 2: last day */
          __("Journeys from %1$s to %2$s will be deleted.", "wordsocket"),
          from,
          to,
        )
      : from
        ? sprintf(
            /* translators: %s: first day */
            __("Journeys from %s on will be deleted.", "wordsocket"),
            from,
          )
        : to
          ? sprintf(
              /* translators: %s: last day */
              __("Journeys up to %s will be deleted.", "wordsocket"),
              to,
            )
          : __("Every journey will be deleted.", "wordsocket");
  return (
    <CollapsibleCard
      title={__("Delete journeys", "wordsocket")}
      icon={<Icon icon={trash} />}
      defaultOpen={false}
    >
      <Stack direction="column" gap="sm" className="wpds-danger">
        <Notice.Root intent="error">
          <Notice.Description>
            <Stack direction="column" gap="sm">
              <Text variant="body-sm">
                {__(
                  "Choose the first and last day to delete, on your site's clock, or leave both empty to delete every journey.",
                  "wordsocket",
                )}
              </Text>
              <Stack direction="row" gap="md" wrap="wrap" align="end">
                <TextControl
                  type="date"
                  label={__("From", "wordsocket")}
                  value={from}
                  max={to || undefined}
                  onChange={setFrom}
                  disabled={purge.isPending}
                  __next40pxDefaultSize
                />
                <TextControl
                  type="date"
                  label={__("To", "wordsocket")}
                  value={to}
                  min={from || undefined}
                  onChange={setTo}
                  disabled={purge.isPending}
                  __next40pxDefaultSize
                />
                <Button
                  variant="secondary"
                  isDestructive
                  onClick={() => setAsking(true)}
                  disabled={inverted || purge.isPending}
                  isBusy={purge.isPending}
                  __next40pxDefaultSize
                >
                  {__("Delete journeys", "wordsocket")}
                </Button>
              </Stack>
            </Stack>
          </Notice.Description>
        </Notice.Root>
        <AlertDialog.Root
          open={asking}
          onOpenChange={(open) => {
            if (!open) setAsking(false);
          }}
          onConfirm={() => {
            void purge.run();
            return { close: true };
          }}
        >
          <AlertDialog.Popup
            intent="irreversible"
            title={__("Delete journeys?", "wordsocket")}
            description={`${scope} ${__("This cannot be undone.", "wordsocket")}`}
            confirmButtonText={__("Delete", "wordsocket")}
          />
        </AlertDialog.Root>
      </Stack>
    </CollapsibleCard>
  );
}

/** Bytes as "2.5 MB", counted by 1024 as a host's panel does. */
function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  /* translators: %s: a size in gigabytes */
  if (mb >= 1024)
    return sprintf(__("%s GB", "wordsocket"), (mb / 1024).toFixed(1));
  /* translators: %s: a size in megabytes */
  if (mb >= 1) return sprintf(__("%s MB", "wordsocket"), mb.toFixed(1));
  /* translators: %s: a size in kilobytes */
  return sprintf(
    __("%s KB", "wordsocket"),
    String(Math.max(1, Math.round(bytes / 1024))),
  );
}

/** The History card: the switch, what the kept journeys take, the months while it is on, and the purge. */
function HistoryCard({
  storage,
  onPurged,
}: {
  storage: JourneyVisuals["storage"] | null;
  onPurged(): void;
}) {
  const history = useSettingSwitch("historyEnabled", {
    success: __("Settings saved.", "wordsocket"),
    error: __("Failed to save settings.", "wordsocket"),
  });
  const { journeysRetentionMonths, setSetting } = useSettings();
  const [draft, setDraft] = useState(journeysRetentionMonths);
  useEffect(() => setDraft(journeysRetentionMonths), [journeysRetentionMonths]);
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
  const { run: save } = saveMonths;
  /* The slider changes on every tick of a drag; the months are saved once they have rested. */
  useEffect(() => {
    if (draft === journeysRetentionMonths) return undefined;
    const timer = window.setTimeout(() => void save(draft), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, journeysRetentionMonths, save]);
  return (
    <CollapsibleCard
      title={__("Settings", "wordsocket")}
      help={__(
        "See how people move through your site: the pages they look at, how long they stay and where they leave. Visits are stored in your own site's database and deleted after the months you choose.",
        "wordsocket",
      )}
      defaultOpen={!history.checked}
    >
      <Stack direction="column" gap="lg">
        <ToggleControl
          label={__("Keep a history of journeys", "wordsocket")}
          checked={history.checked}
          disabled={history.isPending}
          onChange={history.change}
        />
        {storage && (
          <Text variant="body-sm">
            {sprintf(
              /* translators: 1: the table's size, 2: how many journeys it holds */
              _n(
                "%1$s in your database, holding %2$s journey.",
                "%1$s in your database, holding %2$s journeys.",
                storage.rows,
                "wordsocket",
              ),
              formatBytes(storage.bytes),
              storage.rows.toLocaleString(),
            )}
          </Text>
        )}
        {history.checked && (
          <RangeControl
            label={__("Retention (months)", "wordsocket")}
            help={__("Older journeys are deleted automatically.", "wordsocket")}
            min={MONTHS_MIN}
            max={MONTHS_MAX}
            step={1}
            marks={MONTH_MARKS}
            value={draft}
            onChange={(months) => setDraft(months ?? MONTHS_MIN)}
            renderTooltipContent={(months) =>
              sprintf(
                /* translators: %d: months */
                _n("%d month", "%d months", Number(months), "wordsocket"),
                months,
              )
            }
            disabled={saveMonths.isPending}
          />
        )}
        <Stack gap="lg" align="start" className="wpsignal-collapsible-cards">
          <DownloadJourneys />
          <PurgeJourneys onPurged={onPurged} />
        </Stack>
      </Stack>
    </CollapsibleCard>
  );
}

/** One visual in its card: a title, the one sentence on what it is for, the chart. */
function VisualCard({
  title,
  desc,
  children,
  defaultOpen = true,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <CollapsibleCard
      title={title}
      summary={desc}
      icon={<Icon icon={chartBar} />}
      defaultOpen={defaultOpen}
    >
      <Stack direction="column" gap="md">
        {children}
      </Stack>
    </CollapsibleCard>
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
function Visuals({ visuals }: { visuals: VisualsState }) {
  const { historyEnabled } = useSettings();
  const { data, loading, error } = visuals;
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
        {historyEnabled
          ? __(
              "No journeys yet. They appear here as people visit your site.",
              "wordsocket",
            )
          : __(
              "No journeys kept. Turn History on to start recording visits.",
              "wordsocket",
            )}
      </Text>
    );
  }
  return (
    <Stack direction="column" gap="lg">
      <VisualCard
        title={__("Journeys", "wordsocket")}
        desc={__(
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
        defaultOpen={false}
        desc={__(
          "Visits and how they ended, day by day, with a weekly average, so you notice a change the week it happens.",
          "wordsocket",
        )}
      >
        <Trends days={data.days} outcomes={data.outcomes} refInfo={data.ref} />
      </VisualCard>
      <VisualCard
        title={__("When visitors are here", "wordsocket")}
        defaultOpen={false}
        desc={__(
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
  /* A purge remounts the visuals, so every figure and cached page is fetched again. */
  const [version, setVersion] = useState(0);
  const visuals = useVisuals(true, version);
  return (
    <Stack direction="column" gap="lg">
      <TabHeading
        title={title}
        help={__(
          "A journey is one visit to your site: the pages someone looked at, how long they stayed on each, and how the visit ended. With History on, the journeys are drawn below a month at a time, and the weeks and hours over the last four weeks.",
          "wordsocket",
        )}
      />
      <HistoryCard
        storage={visuals.data?.storage ?? null}
        onPurged={() => setVersion((v) => v + 1)}
      />
      {!historyEnabled && (
        <Notice.Root intent="warning">
          <Notice.Title>{__("History is off", "wordsocket")}</Notice.Title>
          <Notice.Description>
            {__(
              "New visits are not being recorded. The journeys kept so far are shown below until the retention deletes them.",
              "wordsocket",
            )}
          </Notice.Description>
        </Notice.Root>
      )}
      <Visuals key={version} visuals={visuals} />
    </Stack>
  );
}
