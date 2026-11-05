/*
 * The moments switch: whether any moment reaches a visitor, and whether the Moments tab is listed.
 * Applies at once and rolls back if the save fails; the toasts come from useTask.
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

/**
 * The Settings tab's moments card.
 *
 * @since 0.31.0
 */
export function MomentsCard() {
  const moments = useSettingSwitch("momentsEnabled", {
    success: __("Settings saved.", "wordsocket"),
    error: __("Failed to save settings.", "wordsocket"),
  });
  return (
    <CollapsibleCard
      title={__("Moments", "wordsocket")}
      help={__(
        "A moment watches each visitor in their own browser and steps in when its conditions come true: a prompt, and the tab title while they are away.",
        "wordsocket",
      )}
      className="wpsignal-settings-card"
      defaultOpen={false}
    >
      <Stack direction="column" gap="md">
        <ToggleControl
          label={__("Enable", "wordsocket")}
          help={__(
            "Adds the Moments tab, where you build them. While this is off no moment reaches a visitor, and the moments you have saved are kept.",
            "wordsocket",
          )}
          checked={moments.checked}
          disabled={moments.isPending}
          onChange={moments.change}
        />
      </Stack>
    </CollapsibleCard>
  );
}
