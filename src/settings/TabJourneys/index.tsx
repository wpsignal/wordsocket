/*
 * Journeys tab, listed while History is on: the download and delete cards and the three visuals over what is kept.
 */

/**
 * WordPress dependencies.
 */
import { __, _n, sprintf } from "@wordpress/i18n";
import { useRef, useState } from "@wordpress/element";
import { Badge, IconButton, Stack } from "@wordpress/ui";
import { update } from "@wordpress/icons";

/**
 * Internal dependencies.
 */
import { TabHeading } from "../TabHeading";
import { JourneyTools } from "./JourneyTools";
import { Visuals } from "./Visuals";
import { useVisuals } from "./useVisuals";
import { DismissibleNotice } from "../DismissibleNotice";

const MB = 1024 * 1024;
const DB_USAGE_CONFIG = {
  high: {
    size: 800 * MB,
    msg: __("You need to delete some journeys to avoid performance issues!", "wordsocket"),
  },
  medium: {
    size: 650 * MB,
    msg: __("Your Journeys are reaching the recommended limit!", "wordsocket"),
  },
  low: {
    size: 500 * MB,
    msg: "",
  },
};

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

/**
 * The tab.
 *
 * @since 0.31.0
 */
export function TabJourneys({ title }: { title: string }) {
  /* A purge or a refresh remounts the visuals, so every figure and cached page is fetched again. */
  const [version, setVersion] = useState(0);
  const visuals = useVisuals(true, version);
  /* The last size stays beside the button while a refresh is on its way. */
  const held = useRef(visuals.data?.storage ?? null);
  if (visuals.data?.storage) held.current = visuals.data.storage;
  const storage = visuals.data?.storage ?? held.current;
  /* As the page's own request found it; unknown counts as present, so nobody is warned on a guess. */
  const cache = window.wpsignalSettings?.history?.persistentCache ?? true;
  const size = storage?.bytes ?? 0;
  const dbBadgeIntent =
    size > DB_USAGE_CONFIG.high.size
      ? "high"
      : size > DB_USAGE_CONFIG.medium.size
        ? "medium"
        : size > DB_USAGE_CONFIG.low.size
          ? "low"
          : "informational";
  return (
    <Stack direction="column" gap="lg">
      <TabHeading
        title={title}
        help={__(
          "A journey is one visit to your site: the pages someone looked at, how long they stayed on each, and how the visit ended. With History on, the journeys are drawn below a month at a time, and the weeks and hours over the last four weeks.",
          "wordsocket",
        )}
      />
      <Stack
        direction="row"
        gap="sm"
        align="center"
        style={{ alignSelf: "flex-end" }}
      >
        {storage && (
          <Badge intent={dbBadgeIntent}>
            {sprintf(
              /* translators: 1: the table's size, 2: how many journeys it holds */
              _n(
                "Database size: %1$s = %2$s journey.",
                "Database size: %1$s = %2$s journeys.",
                storage.rows,
                "wordsocket",
              ),
              formatBytes(storage.bytes),
              storage.rows.toLocaleString(),
            )}
          </Badge>
        )}
        <IconButton
          variant="minimal"
          size="compact"
          tone="neutral"
          icon={update}
          label={__("Refresh the journeys", "wordsocket")}
          disabled={visuals.loading}
          onClick={() => setVersion((v) => v + 1)}
        />
      </Stack>
      {cache === false && (
        <DismissibleNotice
          id="object-cache-missing"
          title={__("Object Cache Missing", "wordsocket")}
        >
          {__(
            "Your host does not support object caching. This could cause performance degradation when Journeys History is enabled.",
            "wordsocket",
          )}
        </DismissibleNotice>
      )}
      <JourneyTools onPurged={() => setVersion((v) => v + 1)} />
      <Visuals key={version} visuals={visuals} />
    </Stack>
  );
}
