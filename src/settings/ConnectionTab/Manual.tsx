/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { Button, TextControl } from "@wordpress/components";
import { createInterpolateElement } from "@wordpress/element";

/**
 * Internal dependencies.
 */
import { useSettings } from "../context";
import { connectWithApiKey } from "../api";

const { isSsl = false } = window.wpSignalConfig ?? {};

/**
 * Manual connection component for non-ssl connections.
 */
export default function Manual({ title = null }: { title?: string | null }) {
  // Context
  const { setSetting, apiKey, fetchStatus } = useSettings();

  async function handleApiKeyConnect(): Promise<void> {
    setSetting("fetchStatus", "connecting");
    setSetting("noticeMessage", null);
    try {
      if (apiKey.length !== 64) {
        setSetting("noticeMessage", {
          type: "error",
          message: __(
            "API Key is invalid, please include a valid API Key and try again.",
            "wordsocket",
          ),
        });
        return;
      }
      const res = await connectWithApiKey(apiKey);
      setSetting("siteKey", res.site_key);
      setSetting("isConnected", true);
      setSetting("fetchStatus", "connected");
    } catch (error: any) {
      setSetting("noticeMessage", {
        type: "error",
        message:
          error?.message ||
          __(
            "Connection failed. Make sure your Server URL and API Key are saved.",
            "wordsocket",
          ),
      });
    }
  }

  return (
    <>
      {title && <h3>{title}</h3>}
      <p>
        {createInterpolateElement(
          __(
            "Copy your API key from the <a>WPSignal dashboard</a> and paste it here.",
            "wordsocket",
          ),
          {
            a: (
              <a
                href="https://api.wpsignal.io/dashboard"
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          },
        )}{" "}
        {!isSsl &&
          ` ${__("(Not available for non-SSL connections)", "wordsocket")}`}
      </p>
      <TextControl
        className={`wpsignal-connection-input${
          fetchStatus === "connecting" ? " is-loading" : ""
        }`}
        label={__("API Key", "wordsocket")}
        value={apiKey}
        minLength={64}
        maxLength={64}
        onChange={(value: string) => setSetting("apiKey", value)}
        type="password"
        __nextHasNoMarginBottom
        __next40pxDefaultSize
      />
      <div className="wpsignal-connection-actions">
        <Button
          variant="secondary"
          onClick={handleApiKeyConnect}
          isBusy={fetchStatus === "connecting"}
          disabled={
            !apiKey || fetchStatus === "connecting" || apiKey.length !== 64
          }
        >
          {__("Save Settings", "wordsocket")}
        </Button>
      </div>
    </>
  );
}
