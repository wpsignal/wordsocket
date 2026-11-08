/*
 * The journeys card: the History switch, which also lists the Journeys tab, and while it is on the
 * retention slider. The switch applies at once and rolls back if the save fails; the months save
 * once the slider has rested.
 */

/**
 * WordPress dependencies.
 */
import { __, _n, sprintf } from "@wordpress/i18n";
import { useEffect, useState } from "@wordpress/element";
import { RangeControl, ToggleControl } from "@wordpress/components";
import { Stack } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { saveSettings } from "../api";
import { useSettings } from "../context";
import { useSettingSwitch } from "./useSettingSwitch";
import { useTask } from "../useTask";
import CollapsibleCard from "../CollapsibleCard";

const MONTHS_MIN = 1;
const MONTHS_MAX = 12;
/** Where the slider's track starts, a quarter before the first mark; a drag below MONTHS_MIN snaps back to it. */
const TRACK_MIN = 0;
/** The months the retention slider labels: the quarter years, which divide the track evenly. */
const MONTH_MARKS = [3, 6, 9, 12].map((value) => ({
  value,
  label: String(value),
}));
/** How long the slider rests before its months are saved. */
const SETTLE_MS = 600;

/**
 * The Settings tab's journeys card.
 *
 * @since 0.31.0
 */
export function JourneysCard() {
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
      title={__("Journeys", "wordsocket")}
      help={__(
        "See how people move through your site: the pages they look at, how long they stay and where they leave. Visits are stored in your own site's database and deleted after the months you choose.",
        "wordsocket",
      )}
      className="wpsignal-settings-card"
      defaultOpen={false}
    >
      <Stack direction="column" gap="lg">
        <ToggleControl
          label={__("Enable", "wordsocket")}
          help={__(
            "Records each visitor's journey through your site, ending where they are now. Journeys data is stored on your site. You own your data.",
            "wordsocket",
          )}
          checked={history.checked}
          disabled={history.isPending}
          onChange={history.change}
        />
        {history.checked && (
          <RangeControl
            label={__("Retention (months)", "wordsocket")}
            help={sprintf(__("After %d months, journeys are deleted.", "wordsocket"), draft)}
            min={TRACK_MIN}
            max={MONTHS_MAX}
            step={1}
            marks={MONTH_MARKS}
            value={draft}
            onChange={(months) =>
              setDraft(Math.max(MONTHS_MIN, months ?? MONTHS_MIN))
            }
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
      </Stack>
    </CollapsibleCard>
  );
}
