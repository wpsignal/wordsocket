import {
  useState,
  useEffect,
  createInterpolateElement,
} from "@wordpress/element";
import {
  TextControl,
  ToggleControl,
  Button,
  Flex,
  FlexItem,
  FlexBlock,
} from "@wordpress/components";
import { Tabs } from "@wordpress/ui";
import { __, sprintf } from "@wordpress/i18n";
import { truncate } from "../../utils";
import { Notice } from "../Notice";
import { getSettings, connect, disconnect, saveSettings } from "../api";
import Automatic from "./Automatic";
import Manual from "./Manual";

interface NoticeState {
  type: "success" | "error";
  message: string | React.ReactNode;
}

export function ConnectionTab() {
  const [apiKey, setApiKey] = useState("");
  const [siteKey, setSiteKey] = useState("");
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [yjsProviderEnabled, setYjsProviderEnabled] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [isRTCEnabled, setIsRTCEnabled] = useState<boolean | null>(null);
  const [wpVersion, setWpVersion] = useState<number>(0);
  const [credentialSource, setCredentialSource] = useState<
    "constant" | "database"
  >("database");
  const [connectionPanel, setConnectionPanel] = useState<
    "automatic" | "manual" | null
  >("automatic");
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const successMessage = (
    <>
      &#10003; {__("Connected", "wordsocket")} &mdash;{" "}
      <code>
        {truncate(siteKey, 8, false)}...
        {truncate(siteKey, 8, true)}
      </code>
    </>
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wpsNotice = params.get("wps_notice");
    if (wpsNotice === "connected" && siteKey) {
      setNotice({
        type: "success",
        message: successMessage,
      });
      if (wpsNotice) {
        // Remove the param from the URL so refreshing doesn't re-show a stale notice.
        const clean = new URL(window.location.href);
        clean.searchParams.delete("wps_notice");
        window.history.replaceState({}, "", clean.toString());
      }
    }
  }, [siteKey]);

  useEffect(() => {
    // Show a notice from the OAuth callback redirect (wps_notice URL param).
    const params = new URLSearchParams(window.location.search);
    const wpsNotice = params.get("wps_notice");
    if (wpsNotice === "error_state") {
      setNotice({
        type: "error",
        message: __(
          "Connection failed: invalid or expired state. Please try again.",
          "wordsocket",
        ),
      });
    } else if (wpsNotice === "error_exchange") {
      setNotice({
        type: "error",
        message: __(
          "Connection failed: could not reach the WPSignal server. Check that your server is reachable.",
          "wordsocket",
        ),
      });
    } else if (wpsNotice === "error_data") {
      setNotice({
        type: "error",
        message: __(
          "Connection failed: unexpected response from server.",
          "wordsocket",
        ),
      });
    } else if (wpsNotice === "error" || wpsNotice?.startsWith("error_")) {
      setNotice({
        type: "error",
        message: __("Connection failed. Please try again.", "wordsocket"),
      });
    } else if (wpsNotice === "cancelled") {
      setNotice({
        type: "error",
        message: __("Connection cancelled.", "wordsocket"),
      });
    }
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      setIsConnecting(true);
      try {
        const res = await getSettings();
        setApiKey(res.api_key);
        setSiteKey(res.site_key);
        setIsConnected(res.is_connected);
        setYjsProviderEnabled(res.yjs_provider_enabled);
        setIsRTCEnabled(Boolean(res.is_rtc_enabled));
        setWpVersion(Number(res.wp_version));
        if (res.credential_source) {
          setCredentialSource(res.credential_source);
        }
      } catch (error: any) {
        setNotice({
          type: "error",
          message:
            error?.message || __("Failed to load settings.", "wordsocket"),
        });
      } finally {
        setIsConnecting(false);
      }
    };
    fetchSettings();
  }, []);

  const handleConnect = async (): Promise<void> => {
    setIsConnecting(true);
    setNotice(null);
    try {
      if (apiKey.length !== 64) {
        setNotice({
          type: "error",
          message: __(
            "API Key is invalid, please include a valid API Key and try again.",
            "wordsocket",
          ),
        });
        return;
      }
      const res = await connect(apiKey);
      setSiteKey(res.site_key);
      setIsConnected(true);
    } catch (error: any) {
      setNotice({
        type: "error",
        message:
          error?.message ||
          __(
            "Connection failed. Make sure your Server URL and API Key are saved.",
            "wordsocket",
          ),
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    setDisconnecting(true);
    setConfirmDisconnect(false);
    setNotice(null);
    try {
      await disconnect();
      setApiKey("");
      setSiteKey("");
      setIsConnected(false);
      setDisconnecting(false);
    } catch (error: any) {
      setNotice({
        type: "error",
        message:
          error?.message ||
          __("Disconnect failed. Please try again.", "wordsocket"),
      });
    }
  };

  const handleYjsProviderChange = async (value: boolean): Promise<void> => {
    setYjsProviderEnabled(value);
    try {
      await saveSettings({ yjs_provider_enabled: value });
      setNotice({
        type: "success",
        message: __("Settings saved.", "wordsocket"),
      });
      setTimeout(() => {
        setNotice(null);
      }, 3000);
    } catch (error: any) {
      setNotice({
        type: "error",
        message:
          error?.message ||
          __(
            "Failed to save Yjs provider settings. Please try again.",
            "wordsocket",
          ),
      });
    }
  };

  const isConstant = credentialSource === "constant";

  return (
    <div className="wpsignal-connection-tab">
      <div className="wpsignal-connection-status">
        {notice ? (
          <Notice status={notice.type}>{notice.message}</Notice>
        ) : (
          <>
            {isConnecting && (
              <Notice status="info">
                {__("Validating connection settings...", "wordsocket")}
              </Notice>
            )}
            {isConnected && <Notice status="success">{successMessage}</Notice>}
            {!notice && !isConnected && isConnecting === false && (
              <Notice status="error">
                {__("Not connected to WPSignal. Try connecting.", "wordsocket")}
              </Notice>
            )}
          </>
        )}
      </div>
      <div className="wpsignal-connection-tabs-container">
        {isConstant ? (
          <Notice status="info">
            {createInterpolateElement(
              __(
                "Credentials are defined in <code>./wp-config.php</code>. To change them, update the <code>WPSIGNAL_SITE_KEY</code>, <code>WPSIGNAL_SITE_SECRET</code>, and <code>WPSIGNAL_JWT_SECRET</code> constants.",
                "wordsocket",
              ),
              { code: <code /> },
            )}
          </Notice>
        ) : !isConnected ? (
          <Tabs.Root
            value={connectionPanel}
            orientation="vertical"
            className="wpsignal-connection-tabs"
            onValueChange={(panel) => {
              setConnectionPanel(panel);
              console.log("Selecting tab", panel);
            }}
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
                  <Automatic isConnecting={isConnecting} />
                </Tabs.Panel>
                <Tabs.Panel value="manual">
                  <Manual
                    isConnecting={isConnecting}
                    apiKey={apiKey}
                    setApiKey={setApiKey}
                    handleConnect={handleConnect}
                  />
                </Tabs.Panel>
              </FlexBlock>
            </Flex>
          </Tabs.Root>
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
                  isBusy={disconnecting || isConnecting}
                  onClick={handleDisconnect}
                >
                  {__("Yes, disconnect", "wordsocket")}
                </Button>
                <Button
                  variant="tertiary"
                  disabled={disconnecting || isConnecting}
                  onClick={() => setConfirmDisconnect(false)}
                >
                  {__("Cancel", "wordsocket")}
                </Button>
              </Flex>
            ) : (
              <Button
                variant="secondary"
                isDestructive
                onClick={() => setConfirmDisconnect(true)}
              >
                {__("Disconnect", "wordsocket")}
              </Button>
            )}
          </div>
        )}
      </div>
      {wpVersion >= 7.0 ? (
        <div className="wpsignal-section">
          {!isConnecting &&
            (isRTCEnabled ? (
              <ToggleControl
                disabled={!isRTCEnabled || isConnecting || !isConnected}
                label={
                  yjsProviderEnabled
                    ? __(
                        "Disable WordSocket for real-time collaboration?",
                        "wordsocket",
                      )
                    : isConnected
                      ? __(
                          "Enable WordSocket for real-time collaboration?",
                          "wordsocket",
                        )
                      : __(
                          "You must be connected to WPSignal to enable real-time collaboration.",
                          "wordsocket",
                        )
                }
                help={isConnected && __(
                  "Registers WordSocket as the Yjs sync provider in the block editor. Disable this to fall back to WordPress HTTP polling if WebSocket connections are unavailable.",
                  "wordsocket",
                )}
                checked={yjsProviderEnabled}
                onChange={handleYjsProviderChange}
                __nextHasNoMarginBottom
              />
            ) : (
              <Notice status="warning">
                {createInterpolateElement(__(
                  "Real-time collaboration is not enabled. Please enable it under <a>Settings > Writing</a>.",
                  "wordsocket",
                ), {
                  a: <a href="/wp-admin/options-writing.php" target="_blank" rel="noopener noreferrer" />,
                })}
              </Notice>
            ))}
        </div>
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
    </div>
  );
}
