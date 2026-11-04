/*
 * Journeys tab: the History card, a notice while History is off, and the three visuals over what is kept.
 */

/**
 * WordPress dependencies.
 */
import { __, _n, sprintf } from "@wordpress/i18n";
import { useState } from "@wordpress/element";
import { Notice, Stack } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { TabHeading } from "../TabHeading";
import { useSettings } from "../context";
import { HistoryCard } from "./HistoryCard";
import { Visuals } from "./Visuals";
import { useVisuals } from "./useVisuals";

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
  const { historyEnabled } = useSettings();
  /* A purge remounts the visuals, so every figure and cached page is fetched again. */
  const [version, setVersion] = useState(0);
  const visuals = useVisuals(true, version);
  const storage = visuals.data?.storage ?? null;
  return (
    <Stack direction="column" gap="lg">
      <TabHeading
        title={title}
        help={__(
          "A journey is one visit to your site: the pages someone looked at, how long they stayed on each, and how the visit ended. With History on, the journeys are drawn below a month at a time, and the weeks and hours over the last four weeks.",
          "wordsocket",
        )}
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
      {storage && (
        <Notice.Root intent="info">
          <Notice.Description>
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
          </Notice.Description>
        </Notice.Root>
      )}
      <HistoryCard onPurged={() => setVersion((v) => v + 1)} />
      <Visuals key={version} visuals={visuals} />
    </Stack>
  );
}
