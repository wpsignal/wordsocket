/*
 * The Journeys tab's History card: the switch, the retention slider, and the download and delete
 * cards under it.
 */

/**
 * WordPress dependencies.
 */
import { __, _n, sprintf } from "@wordpress/i18n";
import { useEffect, useState } from "@wordpress/element";
import {
  Button,
  Icon,
  RangeControl,
  SelectControl,
  TextControl,
  ToggleControl,
} from "@wordpress/components";
import { AlertDialog, Notice, Stack, Text } from "@wordpress/ui";
import { download, trash } from "@wordpress/icons";

/**
 * Internal dependencies.
 */
import { purgeJourneys, saveSettings } from "../api";
import { useSettings } from "../context";
import { useSettingSwitch } from "../TabSettings/useSettingSwitch";
import { useTask } from "../useTask";
import CollapsibleCard from "../CollapsibleCard";

const MONTHS_MIN = 1;
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
      title={__("Download Journeys", "wordsocket")}
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
            {__("Download Journeys", "wordsocket")}
          </Button>
        </Stack>
      </Stack>
    </CollapsibleCard>
  );
}

/** Delete Journeys, every one or those started between two days, behind a confirmation. */
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
      title={__("Delete Journeys", "wordsocket")}
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
                  {__("Delete Journeys", "wordsocket")}
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
            title={__("Delete Journeys?", "wordsocket")}
            description={`${scope} ${__("This cannot be undone.", "wordsocket")}`}
            confirmButtonText={__("Delete", "wordsocket")}
          />
        </AlertDialog.Root>
      </Stack>
    </CollapsibleCard>
  );
}

/**
 * The History card: the switch, the months while it is on, and the purge.
 *
 * @since 0.31.0
 */
export function HistoryCard({ onPurged }: { onPurged(): void }) {
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
          label={__("Keep a history of Journeys", "wordsocket")}
          checked={history.checked}
          disabled={history.isPending}
          onChange={history.change}
        />

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
