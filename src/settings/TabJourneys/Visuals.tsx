/*
 * The Journeys tab's three visuals over the loaded figures: where journeys go, how the weeks are going,
 * when visitors are here.
 */

/**
 * WordPress dependencies.
 */
import { __, sprintf } from "@wordpress/i18n";
import { useMemo, useState } from "@wordpress/element";
import { Icon } from "@wordpress/components";
import { Spinner, Stack, Text } from "@wordpress/ui";
import { chartBar } from "@wordpress/icons";

/**
 * Internal dependencies.
 */
import { useSettings } from "../context";
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
import { useJourneyPage, type VisualsState } from "./useVisuals";

/** Journeys to a page of the network, as `Journeys::VISUALS_JOURNEYS` lists them. */
const PAGE_SIZE = 1000;

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
      className="wpsignal-visual"
      title={title}
      summary={desc}
      icon={<Icon icon={chartBar} />}
      defaultOpen={defaultOpen}
    >
      {children}
    </CollapsibleCard>
  );
}

/** The network's filters from the URL (`&outcome=left&through=product&min=2&pages=2`). */
function filtersFromUrl(): NetworkFilters {
  const min = readUrlParam("min");
  const pages = readUrlParam("pages");
  const outcome = readUrlParam("outcome");
  const through = readUrlParam("through");
  let touched = false;

  // if any value is not null,
  if (min || pages || outcome || through) {
    touched = true;
  }

  return {
    outcome: outcome as Outcome | "",
    through: through ?? "",
    min: Number(min) || DEFAULT_FILTERS.min,
    pages: Number(pages) || DEFAULT_FILTERS.pages,
    touched,
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

/**
 * The three visuals over the loaded figures, or why there are none.
 *
 * @since 0.31.0
 */
export function Visuals({ visuals }: { visuals: VisualsState }) {
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
