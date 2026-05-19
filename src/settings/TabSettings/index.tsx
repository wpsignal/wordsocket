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
      <h4>{__("Realtime Collaboration", "wordsocket")}</h4>
      <Notice status="warning" isDismissible={false}>
        {__("The inclusion of real-time collaboration in WordPress 7.0 has been delayed and is not yet available.", "wordsocket")}
      </Notice>
      {/* {wpVersion >= 7.0 ? (
        isWpRtcEnabled ? (
          <ToggleControl
            disabled={
              !isWpRtcEnabled ||
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
        )
      ) : (
        <>
          {wpVersion === 0 ? (
            rtcLoadingComponent
          ) : (
            <Notice status="warning" isDismissible={false}>
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
      )} */}
    </div>
  );
}
