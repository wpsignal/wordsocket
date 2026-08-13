/**
 * WordPress dependencies.
 */
import { createInterpolateElement } from "@wordpress/element";
import { ToggleControl, Notice } from "@wordpress/components";
import { Badge } from "@wordpress/ui";
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies.
 */
import { saveSettings } from "../api";
import { useSettings } from "../context";

/**
 * Constants.
 */
const {
  wpVersion = 0,
  isWpRtcAvailable = false,
  isWpRtcEnabled = false,
} = window.wpSignalConfig ?? {};

/**
 * Rtc tab.
 */
export function TabSettings({ title }: { title: string }) {
  // Context
  const { yjsProviderEnabled, fetchStatus, isConnected, setSetting } =
    useSettings();

  const handleYjsProviderChange = async (value: boolean): Promise<void> => {
    setSetting("fetchStatus", "connecting");
    setSetting("yjsProviderEnabled", value);
    try {
      await saveSettings({ yjs_provider_enabled: value });
      setSetting("noticeMessage", {
        type: "success",
        message: __("Settings saved.", "wordsocket"),
      });
      setTimeout(() => {
        setSetting("noticeMessage", null);
      }, 3000);
    } catch (error: any) {
      setSetting("noticeMessage", {
        type: "error",
        message:
          error?.message ||
          __(
            "Failed to save Yjs provider settings. Please try again.",
            "wordsocket",
          ),
      });
    } finally {
      setSetting("fetchStatus", "idle");
    }
  };

  const rtcLoadingComponent = (
    <Notice status="info" isDismissible={false}>
      {__("Loading real-time collaboration settings...", "wordsocket")}
    </Notice>
  );

  return (
    <div className="wpsignal-rtc-tab">
      <h2>{title}</h2>
      <h4>
        {__("Realtime Collaboration", "wordsocket")}{" "}
        {/* Temporary badge until RTC ships in WordPress core. */}
        {isWpRtcAvailable && (
          <Badge intent="stable">
            {__("Gutenberg detected", "wordsocket")}
          </Badge>
        )}
      </h4>
      {wpVersion === 0 ? (
        rtcLoadingComponent
      ) : !isWpRtcAvailable ? (
        <Notice status="warning" isDismissible={false}>
          {__(
            "Real-time collaboration is not yet part of WordPress core. This feature is only available with the Gutenberg plugin installed and active.",
            "wordsocket",
          )}
        </Notice>
      ) : isWpRtcEnabled ? (
        <ToggleControl
          disabled={
            ["connecting", "disconnected"].includes(fetchStatus) ||
            !isConnected
          }
          help={__(
            "Registers WordSocket as the Yjs sync provider in the block editor. Disable this to fall back to WordPress HTTP polling.",
            "wordsocket",
          )}
          label={
            yjsProviderEnabled
              ? __(
                  "Disable WordSocket driven realtime collaboration?",
                  "wordsocket",
                )
              : isConnected
                ? __(
                    "Enable WordSocket driven realtime collaboration?",
                    "wordsocket",
                  )
                : __(
                    "You must be connected to WPSignal to enable WordSocket driven realtime collaboration.",
                    "wordsocket",
                  )
          }
          checked={yjsProviderEnabled}
          onChange={handleYjsProviderChange}
          __nextHasNoMarginBottom
        />
      ) : (
        <Notice status="warning" isDismissible={false}>
          {createInterpolateElement(
            __(
              "Real-time collaboration is not enabled. Please enable it under <a>Settings > Writing</a>.",
              "wordsocket",
            ),
            {
              a: (
                <a
                  href="/wp-admin/options-writing.php"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              ),
            },
          )}
        </Notice>
      )}
    </div>
  );
}
