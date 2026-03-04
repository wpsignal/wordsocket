import { useState, useEffect } from "@wordpress/element";
import { TextControl, ToggleControl, Button } from "@wordpress/components";
import { __, sprintf } from "@wordpress/i18n";
import { truncate } from "../utils";
import { Notice } from "./Notice";
import { getSettings, saveSettings, connect } from "./api";

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
      } catch (error: any) {
        setNotice({
          type: "error",
          message:
            error?.message ||
            __("Failed to load settings.", "wordsocket-for-wpsignal"),
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
            "wordsocket-for-wpsignal",
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
            "wordsocket-for-wpsignal",
          ),
      });
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="wpsignal-connection-tab">
      <div className="wpsignal-connection-status">
        {notice ? (
          <Notice status={notice.type}>
            {notice.message.charAt(0).toUpperCase() + notice.message.slice(1)}
          </Notice>
        ) : (
          <>
            {isConnecting && (
              <Notice status="info">
                {__(
                  "Validating connection settings...",
                  "wordsocket-for-wpsignal",
                )}
              </Notice>
            )}
            {isConnected && (
              <Notice status="success">
                &#10003; {__("Connected", "wordsocket-for-wpsignal")}
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
                  "wordsocket-for-wpsignal",
                )}
              </Notice>
            )}
          </>
        )}
      </div>

      <TextControl
        className={`wpsignal-connection-input ${
          isConnecting ? " is-loading" : ""
        }`}
        label={__("API Key", "wordsocket-for-wpsignal")}
        value={apiKey}
        minLength={64}
        maxLength={64}
        onChange={setApiKey}
        type="password"
        help={__(
          "Get your API key from your wpsignal.io dashboard.",
          "wordsocket-for-wpsignal",
        )}
        __nextHasNoMarginBottom
      />
      {wpVersion >= 7.0 ? (
        <>
          {!isConnecting &&
            (isRTCEnabled ? (
              <ToggleControl
                disabled={!isRTCEnabled}
                label={
                  yjsProviderEnabled
                    ? __(
                        "Disable WPSignal for real-time collaboration?",
                        "wordsocket-for-wpsignal",
                      )
                    : __(
                        "Enable WPSignal for real-time collaboration?",
                        "wordsocket-for-wpsignal",
                      )
                }
                help={__(
                  "Registers WPSignal as the Yjs sync provider in the block editor. Disable this to fall back to WordPress HTTP polling if WebSocket connections are unavailable.",
                  "wordsocket-for-wpsignal",
                )}
                checked={yjsProviderEnabled}
                onChange={setYjsProviderEnabled}
                __nextHasNoMarginBottom
              />
            ) : (
              <Notice status="warning">
                {__(
                  "Real-time collaboration is not enabled. Please enable it under Settings > Writing.",
                  "wordsocket-for-wpsignal",
                )}
              </Notice>
            ))}
        </>
      ) : (
        <>
          <Notice status="warning">
            {sprintf(
              __(
                "Real-time collaboration is not supported on WordPress %s. Please upgrade to WordPress 7.0 or later.",
                "wordsocket-for-wpsignal",
              ),
              wpVersion.toString(),
            )}
          </Notice>
        </>
      )}

      <div className="wpsignal-connection-actions">
        <Button
          variant="secondary"
          onClick={handleConnect}
          isBusy={isConnecting}
          disabled={!apiKey || saving || isConnecting || apiKey.length !== 64}
        >
          {__("Save Settings", "wordsocket-for-wpsignal")}
        </Button>
      </div>
    </div>
  );
}
