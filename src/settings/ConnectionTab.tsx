import { useState, useEffect, useRef } from "@wordpress/element";
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
import { truncate } from "../utils";
import { Notice } from "./Notice";
import { getSettings, saveSettings, connect } from "./api";
import { __experimentalGrid as Grid } from "@wordpress/components";

interface NoticeState {
  type: "success" | "error";
  message: string;
}

export function ConnectionTab() {
  const [apiKey, setApiKey] = useState("");
  const [siteKey, setSiteKey] = useState("");
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [yjsProviderEnabled, setYjsProviderEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
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

  useEffect(() => {
    // Show a notice from the OAuth callback redirect (wps_notice URL param).
    const params = new URLSearchParams(window.location.search);
    const wpsNotice = params.get("wps_notice");
    if (wpsNotice) {
      // Remove the param from the URL so refreshing doesn't re-show a stale notice.
      const clean = new URL(window.location.href);
      clean.searchParams.delete("wps_notice");
      window.history.replaceState({}, "", clean.toString());
    }
    if (wpsNotice === "connected") {
      setNotice({
        type: "success",
        message: __("Site connected successfully!", "wordsocket"),
      });
    } else if (wpsNotice === "error_state") {
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

  const handleOAuthConnect = (): void => {
    const oauthStartUrl = (window as any).wpsignalSettings?.oauthStartUrl;
    if (oauthStartUrl) {
      window.location.href = oauthStartUrl;
    }
  };

  const isConstant = credentialSource === "constant";

  return (
    <div className="wpsignal-connection-tab">
      <h2>{__("Connect", "wordsocket")}</h2>
      <div className="wpsignal-connection-status">
        {notice ? (
          <Notice status={notice.type}>
            {notice.message.charAt(0).toUpperCase() + notice.message.slice(1)}
          </Notice>
        ) : (
          <>
            {isConnecting && (
              <Notice status="info">
                {__("Validating connection settings...", "wordsocket")}
              </Notice>
            )}
            {isConnected && (
              <Notice status="success">
                &#10003; {__("Connected", "wordsocket")}
                {siteKey && (
                  <>
                    {" "}
                    &mdash;{" "}
                    <code>
                      {truncate(siteKey, 8, false)}...
                      {truncate(siteKey, 8, true)}
                    </code>
                  </>
                )}
              </Notice>
            )}
            {!notice && !isConnected && isConnecting === false && (
              <Notice status="error">
                {__(
                  "Connection failed. Make sure your API Key is valid.",
                  "wordsocket",
                )}
              </Notice>
            )}
          </>
        )}
      </div>

     
        {isConstant ? (
          <Notice status="info">
            {__(
              "Credentials are defined in wp-config.php (read-only). To change them, update the WPSIGNAL_SITE_KEY, WPSIGNAL_SITE_SECRET, and WPSIGNAL_JWT_SECRET constants.",
              "wordsocket",
            )}
          </Notice>
        ) : (
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
                  <p>
                    {__(
                      "Log in to your WPSignal dashboard and authorize this site in one click.",
                      "wordsocket",
                    )}
                  </p>
                  <Button
                    variant="primary"
                    onClick={handleOAuthConnect}
                    disabled={isConnecting}
                  >
                    {__("Connect with WPSignal", "wordsocket")}
                  </Button>
                </Tabs.Panel>
                <Tabs.Panel value="manual">
                  <TextControl
                    className={`wpsignal-connection-input${
                      isConnecting ? " is-loading" : ""
                    }`}
                    label={__("API Key", "wordsocket")}
                    value={apiKey}
                    minLength={64}
                    maxLength={64}
                    onChange={setApiKey}
                    type="password"
                    help={__(
                      "Copy your API key from the WPSignal dashboard and paste it here.",
                      "wordsocket",
                    )}
                    __nextHasNoMarginBottom
                  />
                  <div className="wpsignal-connection-actions">
                    <Button
                      variant="secondary"
                      onClick={handleConnect}
                      isBusy={isConnecting}
                      disabled={
                        !apiKey ||
                        saving ||
                        isConnecting ||
                        apiKey.length !== 64
                      }
                    >
                      {__("Save Settings", "wordsocket")}
                    </Button>
                  </div>
                </Tabs.Panel>
              </FlexBlock>
            </Flex>
          </Tabs.Root>
        )}
        {wpVersion >= 7.0 ? (
          <div className="wpsignal-section">
            {!isConnecting &&
              (isRTCEnabled ? (
                <ToggleControl
                  disabled={!isRTCEnabled}
                  label={
                    yjsProviderEnabled
                      ? __(
                          "Disable WordSocket for real-time collaboration?",
                          "wordsocket",
                        )
                      : __(
                          "Enable WordSocket for real-time collaboration?",
                          "wordsocket",
                        )
                  }
                  help={__(
                    "Registers WordSocket as the Yjs sync provider in the block editor. Disable this to fall back to WordPress HTTP polling if WebSocket connections are unavailable.",
                    "wordsocket",
                  )}
                  checked={yjsProviderEnabled}
                  onChange={setYjsProviderEnabled}
                  __nextHasNoMarginBottom
                />
              ) : (
                <Notice status="warning">
                  {__(
                    "Real-time collaboration is not enabled. Please enable it under Settings > Writing.",
                    "wordsocket",
                  )}
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
