/**
 * WordPress dependencies.
 */
import { createInterpolateElement } from "@wordpress/element";
import { ToggleControl, Notice, Tooltip, Icon } from "@wordpress/components";
import { __, sprintf } from "@wordpress/i18n";

/**
 * Internal dependencies.
 */
import { saveSettings } from "../api";
import { useSettings } from "../context";

/**
 * Constants.
 */
const { wpVersion = 0, isWpRtcEnabled = false } = window.wpSignalConfig ?? {};

/**
 * Rtc tab.
 */
export function RtcTab() {
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
    <Notice status="info">
      {__("Loading real-time collaboration settings...", "wordsocket")}
    </Notice>
  );

  return (
    <div className="wpsignal-rtc-tab">
      <h3>
        <Tooltip
          text={__(
            "Registers WordSocket as the Yjs sync provider in the block editor. Disable this to fall back to WordPress HTTP polling.",
            "wordsocket",
          )}
        >
          <Icon size={16} icon="editor-help" />
        </Tooltip>{" "}
        {__("Realtime Collaboration:", "wordsocket")}
      </h3>
      {wpVersion >= 7.0 ? (
        <div className="wpsignal-section">
          {isWpRtcEnabled ? (
            <ToggleControl
              disabled={
                !isWpRtcEnabled ||
                ["connecting", "disconnected"].includes(fetchStatus) ||
                !isConnected
              }
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
            <Notice status="warning">
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
      ) : (
        <>
          {wpVersion === 0 ? (
            rtcLoadingComponent
          ) : (
            <Notice status="warning">
              {sprintf(
                __(
                  "Real-time collaboration is not supported on WordPress %s. Please upgrade to WordPress 7.0 or later.",
                  "wordsocket",
                ),
                wpVersion.toString(),
              )}
            </Notice>
          )}
        </>
      )}
    </div>
  );
}
