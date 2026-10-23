/**
 * WordPress dependencies.
 */
import {
  useState,
  createInterpolateElement,
  useEffect,
  Fragment,
} from "@wordpress/element";
import {
  Flex,
  Button,
  FlexItem,
  FlexBlock,
  ProgressBar,
  Notice,
  __experimentalTruncate as Truncate,
} from "@wordpress/components";
import { Stack, Tabs, Text } from "@wordpress/ui";
import { __, sprintf } from "@wordpress/i18n";

/**
 * Internal dependencies.
 */
import Manual from "./Manual";
import Automatic from "./Automatic";
import { useSettings } from "../context";
import { TabHeading } from "../TabHeading";

const { isSsl = false, isConstant = false } = window.wpSignalConfig ?? {};

/**
 * Read the OAuth callback's wps_notice / wps_message from the URL and remove
 * them so they only ever apply to the load that carried them.
 */
function consumeCallbackParams(): {
  notice: string | null;
  reason: string | null;
} {
  const url = new URL(window.location.href);
  const notice = url.searchParams.get("wps_notice");
  const reason = url.searchParams.get("wps_message");
  if (notice !== null || reason !== null) {
    url.searchParams.delete("wps_notice");
    url.searchParams.delete("wps_message");
    window.history.replaceState(window.history.state, "", url.toString());
  }
  return { notice, reason };
}

export function TabConnection({ title }: { title: string }) {
  // Context
  const {
    siteKey,
    isConnected,
    fetchStatus,
    noticeMessage,
    connectionType,
    handleDisconnect,
    setSetting,
    successMessage,
    lastError,
    confirmDisconnect,
  } = useSettings();

  /*
   * The OAuth callback lands with wps_notice in the URL, read once and stripped, or a reload after
   * a later manual connect would show the stale notice.
   */
  const [callback] = useState(() => consumeCallbackParams());

  useEffect(() => {
    if (callback.notice === "connected" && siteKey) {
      setSetting("noticeMessage", {
        type: "success",
        message: successMessage(siteKey),
      });
    }
  }, [siteKey]);

  useEffect(() => {
    const { notice, reason } = callback;
    if (notice === "error_state") {
      setSetting("noticeMessage", {
        type: "error",
        message: __(
          "Connection failed: invalid or expired state. Please try again.",
          "wordsocket",
        ),
      });
    } else if (notice === "error_exchange") {
      setSetting("noticeMessage", {
        type: "error",
        message: reason
          ? sprintf(
              /* translators: %s: reason given by the WPSignal server */
              __("Connection failed: %s", "wordsocket"),
              reason,
            )
          : __(
              "Connection failed: could not reach the WPSignal server. Check that your server is reachable.",
              "wordsocket",
            ),
      });
    } else if (notice === "error_denied") {
      setSetting("noticeMessage", {
        type: "error",
        message: reason
          ? sprintf(
              /* translators: %s: reason given by the WPSignal server */
              __("Connection refused: %s", "wordsocket"),
              reason,
            )
          : __("Connection refused by the WPSignal server.", "wordsocket"),
      });
    } else if (notice === "error_data") {
      setSetting("noticeMessage", {
        type: "error",
        message: __(
          "Connection failed: unexpected response from server.",
          "wordsocket",
        ),
      });
    } else if (notice === "error" || notice?.startsWith("error_")) {
      setSetting("noticeMessage", {
        type: "error",
        message: __("Connection failed. Please try again.", "wordsocket"),
      });
    } else if (notice === "cancelled") {
      setSetting("noticeMessage", {
        type: "error",
        message: __("Connection cancelled.", "wordsocket"),
      });
    }
  }, []);

  return (
    <Stack direction="column" gap="lg" className="wpsignal-connection-tab">
      <TabHeading
        title={title}
        help={__(
          "Authorize this site to connect to WPSignal. This will allow you to receive real-time events from your site.",
          "wordsocket",
        )}
      />
      <Stack direction="column" gap="sm">
        {["connecting", "disconnecting"].includes(fetchStatus) && (
          <ProgressBar className="wpsignal-progress-bar" />
        )}
        {noticeMessage ? (
          <Notice status={noticeMessage.type} isDismissible={false}>
            {noticeMessage.message}
          </Notice>
        ) : (
          <>
            {fetchStatus === "connecting" && (
              <Notice status="info" isDismissible={false}>
                {__("Validating connection settings...", "wordsocket")}
              </Notice>
            )}
            {isConnected && !lastError && (
              <Notice status="success" isDismissible={false}>
                {successMessage(siteKey)}
              </Notice>
            )}
            {isConnected && lastError && (
              <Notice status="error" isDismissible={false}>
                <Fragment>
                  {__("Connected as", "wordsocket")}{" "}
                  <code>
                    <Truncate limit={16} ellipsizeMode="middle" ellipsis="...">
                      {siteKey}
                    </Truncate>
                  </code>
                  {", "}
                  {__("but events are not being delivered.", "wordsocket")}{" "}
                  {lastError.message}
                </Fragment>
                {lastError.detail && lastError.detail !== lastError.message && (
                  <details>
                    <summary>{__("Show error details", "wordsocket")}</summary>
                    <Text variant="body-sm" render={<p />}>
                      <code>{lastError.detail}</code>
                    </Text>
                  </details>
                )}
              </Notice>
            )}
            {!isConnected && ["idle", "disconnected"].includes(fetchStatus) && (
              <Notice status="error" isDismissible={false}>
                {__("Not connected to WPSignal. Try connecting.", "wordsocket")}
              </Notice>
            )}
          </>
        )}
      </Stack>
      <div>
        {isConstant ? (
          <Notice status="info" isDismissible={false}>
            {createInterpolateElement(
              __(
                "Credentials are defined in <code>./wp-config.php</code>. To change them, update the <code>WPSIGNAL_SITE_KEY</code>, <code>WPSIGNAL_SITE_SECRET</code>, and <code>WPSIGNAL_JWT_SECRET</code> constants.",
                "wordsocket",
              ),
              { code: <code /> },
            )}
          </Notice>
        ) : !isConnected ? (
          isSsl ? (
            <Tabs.Root
              value={connectionType}
              orientation="vertical"
              className="wpsignal-connection-tabs"
              onValueChange={(value: "automatic" | "manual") =>
                setSetting("connectionType", value)
              }
            >
              <Flex align="start">
                <FlexItem>
                  <Tabs.List>
                    <Tabs.Tab value="automatic">
                      {__("Automatic", "wordsocket")}
                    </Tabs.Tab>
                    <Tabs.Tab value="manual">
                      {__("Manual", "wordsocket")}
                    </Tabs.Tab>
                  </Tabs.List>
                </FlexItem>
                <FlexBlock className="wpsignal-connection-tabs-content">
                  <Tabs.Panel value="automatic">
                    <Automatic isConnecting={fetchStatus === "connecting"} />
                  </Tabs.Panel>
                  <Tabs.Panel value="manual">
                    <Manual title={__("Manual Connection", "wordsocket")} />
                  </Tabs.Panel>
                </FlexBlock>
              </Flex>
            </Tabs.Root>
          ) : (
            <Manual />
          )
        ) : (
          <Stack direction="column" gap="md" align="flex-start">
            <Text render={<p />}>
              {__(
                "You are connected to WPSignal. To disconnect, click the button below.",
                "wordsocket",
              )}
            </Text>
            {confirmDisconnect ? (
              <Stack direction="row" gap="md" align="center" wrap="wrap">
                <Text>
                  {__(
                    "Disconnect this site? Stored credentials are removed; your usage history is kept and reconnecting restores the site.",
                    "wordsocket",
                  )}
                </Text>
                <Button
                  variant="primary"
                  isDestructive
                  isBusy={fetchStatus === "disconnecting"}
                  onClick={handleDisconnect}
                >
                  {__("Yes, disconnect", "wordsocket")}
                </Button>
                <Button
                  variant="tertiary"
                  disabled={
                    fetchStatus === "disconnecting" ||
                    fetchStatus === "connecting"
                  }
                  onClick={() => setSetting("confirmDisconnect", false)}
                >
                  {__("Cancel", "wordsocket")}
                </Button>
              </Stack>
            ) : (
              <Button
                variant="secondary"
                isDestructive
                isBusy={
                  fetchStatus === "disconnecting" ||
                  fetchStatus === "connecting"
                }
                onClick={() => setSetting("confirmDisconnect", true)}
              >
                {__("Disconnect", "wordsocket")}
              </Button>
            )}
          </Stack>
        )}
      </div>
    </Stack>
  );
}
