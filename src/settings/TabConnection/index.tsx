/**
 * WordPress dependencies.
 */
import {
  useState,
  createInterpolateElement,
  useEffect,
} from "@wordpress/element";
import {
  Flex,
  Button,
  FlexItem,
  FlexBlock,
  ProgressBar,
  Tooltip,
  Icon,
} from "@wordpress/components";
import { Tabs } from "@wordpress/ui";
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies.
 */
import Manual from "./Manual";
import Automatic from "./Automatic";
import { Notice } from "../Notice";
import { useSettings } from "../context";

const { isSsl = false, isConstant = false } = window.wpSignalConfig ?? {};

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
  } = useSettings();

  // Show a notice from the OAuth callback redirect (wps_notice URL param).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wpsNotice = params.get("wps_notice");
    if (wpsNotice === "connected" && siteKey) {
      setSetting("noticeMessage", {
        type: "success",
        message: successMessage(siteKey),
      });
    }
  }, [siteKey]);

  // Notification messages handling
  useEffect(() => {
    // OAuth callback redirect (wps_notice URL param).
    const params = new URLSearchParams(window.location.search);
    const wpsNotice = params.get("wps_notice");
    if (wpsNotice === "error_state") {
      setSetting("noticeMessage", {
        type: "error",
        message: __(
          "Connection failed: invalid or expired state. Please try again.",
          "wordsocket",
        ),
      });
    } else if (wpsNotice === "error_exchange") {
      setSetting("noticeMessage", {
        type: "error",
        message: __(
          "Connection failed: could not reach the WPSignal server. Check that your server is reachable.",
          "wordsocket",
        ),
      });
    } else if (wpsNotice === "error_data") {
      setSetting("noticeMessage", {
        type: "error",
        message: __(
          "Connection failed: unexpected response from server.",
          "wordsocket",
        ),
      });
    } else if (wpsNotice === "error" || wpsNotice?.startsWith("error_")) {
      setSetting("noticeMessage", {
        type: "error",
        message: __("Connection failed. Please try again.", "wordsocket"),
      });
    } else if (wpsNotice === "cancelled") {
      setSetting("noticeMessage", {
        type: "error",
        message: __("Connection cancelled.", "wordsocket"),
      });
    }
  }, []);

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  return (
    <div className="wpsignal-connection-tab">
      <h2>
        <Tooltip
          text={__(
            "Authorize this site to connect to WPSignal. This will allow you to receive real-time events from your site.",
            "wordsocket",
          )}
        >
          <span>
            <Icon size={16} icon="editor-help" />
          </span>
        </Tooltip>{" "}
        {title}
      </h2>
      <div className="wpsignal-connection-status">
        {["connecting", "disconnecting"].includes(fetchStatus) && (
          <ProgressBar className="wpsignal-progress-bar" />
        )}
        {noticeMessage ? (
          <Notice status={noticeMessage.type} isDismissible={false}>{noticeMessage.message}</Notice>
        ) : (
          <>
            {fetchStatus === "connecting" && (
              <Notice status="info" isDismissible={false}>
                {__("Validating connection settings...", "wordsocket")}
              </Notice>
            )}
            {isConnected && (
              <Notice status="success">{successMessage(siteKey)}</Notice>
            )}
            {!isConnected && ["idle", "disconnected"].includes(fetchStatus) && (
              <Notice status="error">
                {__("Not connected to WPSignal. Try connecting.", "wordsocket")}
              </Notice>
            )}
          </>
        )}
      </div>
      <div className="wpsignal-connection-tabs-container">
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
          <div className="wpsignal-disconnect-actions">
            <p>
              {__(
                "You are connected to WPSignal. To disconnect, click the button below.",
                "wordsocket",
              )}
            </p>
            {confirmDisconnect ? (
              <Flex align="center" gap={5} expanded={false} justify="start">
                <span className="wpsignal-disconnect-confirm-label">
                  {__(
                    "Are you sure you want to disconnect this site from WPSignal?",
                    "wordsocket",
                  )}
                </span>
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
                  onClick={() => setConfirmDisconnect(false)}
                >
                  {__("Cancel", "wordsocket")}
                </Button>
              </Flex>
            ) : (
              <Button
                variant="secondary"
                isDestructive
                isBusy={
                  fetchStatus === "disconnecting" ||
                  fetchStatus === "connecting"
                }
                onClick={() => setConfirmDisconnect(true)}
              >
                {__("Disconnect", "wordsocket")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
