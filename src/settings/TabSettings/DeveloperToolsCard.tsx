/*
 * The developer tools switch: shows the Triggers and Explorer tabs. Applies at once and rolls back
 * if the save fails; the toasts come from useTask.
 */

/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { ToggleControl } from "@wordpress/components";
import { CollapsibleCard, Card, Stack } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { useSettingSwitch } from "./useSettingSwitch";

export function DeveloperToolsCard() {
  const developerMode = useSettingSwitch("developerMode", {
    success: __("Settings saved.", "wordsocket"),
    error: __("Failed to save settings.", "wordsocket"),
  });
  return (
    <CollapsibleCard.Root className="wpsignal-settings-card">
      <CollapsibleCard.Header>
        <Card.Title>{__("Developer tools", "wordsocket")}</Card.Title>
      </CollapsibleCard.Header>
      <CollapsibleCard.Content>
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
            __nextHasNoMarginBottom
          />
        </Stack>
      </CollapsibleCard.Content>
    </CollapsibleCard.Root>
  );
}
