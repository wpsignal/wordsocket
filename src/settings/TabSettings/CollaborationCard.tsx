/*
 * The real-time collaboration card: without the Gutenberg plugin a notice, with it but the
 * experiment off a link to switch it on, and with both the Yjs provider switch applying at once
 * with rollback.
 */

/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { createInterpolateElement } from "@wordpress/element";
import { Notice, ToggleControl } from "@wordpress/components";
import { Stack } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { useSettings } from "../context";
import { useSettingSwitch } from "./useSettingSwitch";
import CollapsibleCard from "../CollapsibleCard";

const {
  available: isWpRtcAvailable = false,
  enabled: isWpRtcEnabled = false,
  experimentsUrl = "",
} = window.wpsignalSettings?.rtc ?? {};

export function CollaborationCard() {
  const { fetchStatus, isConnected } = useSettings();
  const provider = useSettingSwitch("yjsProviderEnabled", {
    success: __("Settings saved.", "wordsocket"),
    error: __(
      "Failed to save Yjs provider settings. Please try again.",
      "wordsocket",
    ),
  });
  return (
    <CollapsibleCard
      title={__("Realtime collaboration", "wordsocket")}
      className="wpsignal-settings-card"
      defaultOpen={false}
    >
      <Stack direction="column" gap="md">
        {!isWpRtcAvailable ? (
          <Notice status="warning" isDismissible={false}>
            {__(
              "Real-time collaboration is not yet part of WordPress core. This feature is only available with the Gutenberg plugin installed and active.",
              "wordsocket",
            )}
          </Notice>
        ) : isWpRtcEnabled ? (
          <ToggleControl
            disabled={
              provider.isPending ||
              ["connecting", "disconnected"].includes(fetchStatus) ||
              !isConnected
            }
            help={__(
              "Only available with the Gutenberg plugin installed and active.",
              "wordsocket",
            )}
            label={__("Enable?", "wordsocket")}
            checked={provider.checked}
            onChange={provider.change}
          />
        ) : (
          <Notice status="warning" isDismissible={false}>
            {createInterpolateElement(
              __(
                "Realtime collaboration is not enabled. Turn on <a>Gutenberg > Experiments > Enable real-time collaboration</a>.",
                "wordsocket",
              ),
              {
                a: (
                  <a
                    href={experimentsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                ),
              },
            )}
          </Notice>
        )}
      </Stack>
    </CollapsibleCard>
  );
}
