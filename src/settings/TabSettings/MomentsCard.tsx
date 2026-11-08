/*
 * The moments switch: whether any moment reaches a visitor, and whether the Moments tab is listed.
 * Applies at once and rolls back if the save fails; the toasts come from useTask. Under it the
 * Style prompts button, which opens the dialog for the look of every prompt.
 */

/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { useState } from "@wordpress/element";
import { ToggleControl } from "@wordpress/components";
import { Button, Icon, Stack, Text } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { useSettingSwitch } from "./useSettingSwitch";
import { PromptStyleDialog } from "./PromptStyleDialog";
import CollapsibleCard from "../CollapsibleCard";
import { brush } from "@wordpress/icons";

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
  const [promptStyle, setPromptStyle] = useState(
    window.wpsignalSettings?.promptStyle,
  );
  const [styling, setStyling] = useState(false);
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
        {promptStyle && (
          <Stack direction="column" gap="md" align="start">
            <Text variant="heading-sm">
              {__("Prompts styling", "wordsocket")}
            </Text>
            <Button variant="outline" onClick={() => setStyling(true)}>
              <Icon icon={brush} /> {__("Open Style Editor", "wordsocket")}
            </Button>
            <Text variant="body-sm" className="wpsignal-muted">
              {__(
                "Click to adjust the colors, spacing and motion of the prompts your Moments show.",
                "wordsocket",
              )}
            </Text>
          </Stack>
        )}
        {styling && promptStyle && (
          <PromptStyleDialog
            config={promptStyle}
            onClose={() => setStyling(false)}
            onSaved={setPromptStyle}
          />
        )}
      </Stack>
    </CollapsibleCard>
  );
}
