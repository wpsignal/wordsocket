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
import { useTask } from "../useTask";

/**
 * Constants.
 */
const { available: isWpRtcAvailable = false, enabled: isWpRtcEnabled = false } =
  window.wpsignalSettings?.rtc ?? {};

/**
 * Settings tab: the developer tools switch, and the real-time collaboration
 * switch while Gutenberg's experiment is on (nothing about collaboration is
 * shown otherwise, so a site owner never meets a feature core has not shipped).
 */
export function TabSettings({ title }: { title: string }) {
  // Context
  const {
    yjsProviderEnabled,
    developerMode,
    fetchStatus,
    isConnected,
    setSetting,
  } = useSettings();

  // Each switch applies at once and rolls back if the save fails; the toasts come from useTask.
  const saveDeveloperMode = useTask(
    (value: boolean) => saveSettings({ developer_mode: value }),
    {
      success: __("Settings saved.", "wordsocket"),
      error: __("Failed to save settings.", "wordsocket"),
      onError: (_error, value) => setSetting("developerMode", !value),
    },
  );
  const handleDeveloperMode = (value: boolean) => {
    setSetting("developerMode", value);
    return saveDeveloperMode.run(value);
  };

  const saveYjsProvider = useTask(
    (value: boolean) => saveSettings({ yjs_provider_enabled: value }),
    {
      success: __("Settings saved.", "wordsocket"),
      error: __(
        "Failed to save Yjs provider settings. Please try again.",
        "wordsocket",
      ),
      onError: (_error, value) => setSetting("yjsProviderEnabled", !value),
    },
  );
  const handleYjsProviderChange = (value: boolean) => {
    setSetting("yjsProviderEnabled", value);
    return saveYjsProvider.run(value);
  };

  return (
    <div className="wpsignal-rtc-tab">
      <h2>{title}</h2>
      <h4>{__("Developer tools", "wordsocket")}</h4>
      <ToggleControl
        label={__("Show the Triggers and Explorer tabs", "wordsocket")}
        help={__(
          "For developers wiring WordPress hooks to events and watching them arrive.",
          "wordsocket",
        )}
        checked={developerMode}
        disabled={saveDeveloperMode.isPending}
        onChange={handleDeveloperMode}
        __nextHasNoMarginBottom
      />
      {isWpRtcEnabled && (
        <>
          <h4>
            {__("Realtime Collaboration", "wordsocket")}{" "}
            {/* Temporary badge until RTC ships in WordPress core. */}
          </h4>
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
                saveYjsProvider.isPending ||
                ["connecting", "disconnected"].includes(fetchStatus) ||
                !isConnected
              }
              help={__(
                "Only available with the Gutenberg plugin installed and active.",
                "wordsocket",
              )}
              label={__(
                "Enable?",
                "wordsocket",
              )}
              checked={yjsProviderEnabled}
              onChange={handleYjsProviderChange}
              __nextHasNoMarginBottom
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
                      href="/wp-admin/admin.php?page=gutenberg-experiments"
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  ),
                },
              )}
            </Notice>
          )}
        </>
      )}
    </div>
  );
}
