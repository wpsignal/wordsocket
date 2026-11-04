/*
 * The developer tools switch: shows the Triggers and Explorer tabs. Applies at once and rolls back
 * if the save fails; the toasts come from useTask.
 */

/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { ToggleControl } from "@wordpress/components";
import { Stack } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { useSettingSwitch } from "./useSettingSwitch";
import CollapsibleCard from "../CollapsibleCard";

export function DeveloperToolsCard() {
  const developerMode = useSettingSwitch("developerMode", {
    success: __("Settings saved.", "wordsocket"),
    error: __("Failed to save settings.", "wordsocket"),
  });
  return (
    <CollapsibleCard
      title={__("Developer tools", "wordsocket")}
      className="wpsignal-settings-card"
      defaultOpen={false}
    >
      <Stack direction="column" gap="md">
        <ToggleControl
          label={__("Show the Triggers and Explorer tabs", "wordsocket")}
          help={__(
            "For developers wiring WordPress hooks to events and watching them arrive.",
            "wordsocket",
          )}
          checked={developerMode.checked}
          disabled={developerMode.isPending}
          onChange={developerMode.change}
        />
      </Stack>
    </CollapsibleCard>
  );
}
