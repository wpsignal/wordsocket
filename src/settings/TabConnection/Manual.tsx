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

const { isSsl = false, dashboardUrl = "https://api.wpsignal.io/dashboard" } =
  window.wpSignalConfig ?? {};

/** The settings endpoint returns a stored key as `****` plus its last four characters. */
const isMaskedKey = (value: string) => /^\*{4}.{4}$/.test(value);
const isValidKey = (value: string) => value.length === 64 || isMaskedKey(value);

/**
 * Manual connection component for non-ssl connections.
 */
export default function Manual({ title = null }: { title?: string | null }) {
  // Context
  const { setSetting, apiKey, fetchStatus } = useSettings();

  async function handleApiKeyConnect(): Promise<void> {
    setSetting("noticeMessage", null);
    if (!isValidKey(apiKey)) {
      setSetting("noticeMessage", {
        type: "error",
        message: __(
          "API Key is invalid, please include a valid API Key and try again.",
          "wordsocket",
        ),
      });
      return;
    }
    setSetting("fetchStatus", "connecting");
    let connected = false;
    try {
      const res = await connectWithApiKey(apiKey);
      setSetting("siteKey", res.site_key);
      setSetting("isConnected", true);
      connected = true;
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
    } finally {
      // Never leave the form stuck in "connecting": a failed attempt must be retryable.
      setSetting("fetchStatus", connected ? "connected" : "idle");
    }
  }

  return (
    <>
      {title && <h3>{title}</h3>}
      <p>
      {!isSsl &&
          __("To use automatic OAuth, you'll need to enable SSL for this site.", "wordsocket")}{" "}
        {createInterpolateElement(
          __(
            "Alternatively, copy your API key from the <a>WPSignal dashboard</a> and paste it here.",
            "wordsocket",
          ),
          {
            a: (
              <a
                href={dashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          },
        )}       
      </p>
      <TextControl
        className={`wpsignal-connection-input${
          fetchStatus === "connecting" ? " is-loading" : ""
        }`}
        label={__("API Key", "wordsocket")}
        value={apiKey}
        maxLength={64}
        onChange={(value: string) => setSetting("apiKey", value)}
        help={
          isMaskedKey(apiKey)
            ? __("A key is already saved. Paste a new one to replace it.", "wordsocket")
            : undefined
        }
        type={isMaskedKey(apiKey) ? "text" : "password"}
        __nextHasNoMarginBottom
        __next40pxDefaultSize
      />
      <div className="wpsignal-connection-actions">
        <Button
          variant="secondary"
          onClick={handleApiKeyConnect}
          isBusy={fetchStatus === "connecting"}
          disabled={fetchStatus === "connecting" || !isValidKey(apiKey)}
        >
          {__("Save Settings", "wordsocket")}
        </Button>
      </div>
    </>
  );
}
