/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { Button, TextControl } from "@wordpress/components";
import { Stack, Text } from "@wordpress/ui";
import { createInterpolateElement } from "@wordpress/element";

/**
 * Internal dependencies.
 */
import { useSettings } from "../context";
import { connectWithApiKey } from "../api";
import { useTask } from "../useTask";

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

  const connect = useTask(
    async (key: string) => {
      if (!isValidKey(key)) {
        throw new Error(
          __(
            "API Key is invalid, please include a valid API Key and try again.",
            "wordsocket",
          ),
        );
      }
      return connectWithApiKey(key);
    },
    {
      success: __("Connected to WPSignal.", "wordsocket"),
      error: __(
        "Connection failed. Make sure your Server URL and API Key are saved.",
        "wordsocket",
      ),
      onSuccess: (res) => {
        setSetting("siteKey", res.site_key);
        setSetting("isConnected", true);
      },
      // Never leave the form stuck in "connecting": a failed attempt must be retryable.
      onSettled: (outcome) =>
        setSetting("fetchStatus", outcome.ok ? "connected" : "idle"),
    },
  );

  function handleApiKeyConnect(): void {
    setSetting("noticeMessage", null);
    setSetting("fetchStatus", "connecting");
    connect.run(apiKey);
  }

  return (
    <Stack direction="column" gap="md" align="stretch">
      {title && (
        <Text variant="heading-md" render={<h3 />}>
          {title}
        </Text>
      )}
      <Text render={<p />}>
        {!isSsl &&
          __(
            "To use automatic OAuth, you'll need to enable SSL for this site.",
            "wordsocket",
          )}{" "}
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
      </Text>
      <TextControl
        label={__("API Key", "wordsocket")}
        disabled={fetchStatus === "connecting"}
        value={apiKey}
        maxLength={64}
        onChange={(value: string) => setSetting("apiKey", value)}
        help={
          isMaskedKey(apiKey)
            ? __(
                "A key is already saved. Paste a new one to replace it.",
                "wordsocket",
              )
            : undefined
        }
        type={isMaskedKey(apiKey) ? "text" : "password"}
        __nextHasNoMarginBottom
        __next40pxDefaultSize
      />
      <Stack direction="row" gap="sm">
        <Button
          variant="secondary"
          onClick={handleApiKeyConnect}
          isBusy={fetchStatus === "connecting"}
          disabled={fetchStatus === "connecting" || !isValidKey(apiKey)}
        >
          {__("Save Settings", "wordsocket")}
        </Button>
      </Stack>
    </Stack>
  );
}
