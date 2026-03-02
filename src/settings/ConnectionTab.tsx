import { useState, useEffect } from "@wordpress/element";
import {
  TextControl,
  ToggleControl,
  Button,
} from "@wordpress/components";
import { __ } from "@wordpress/i18n";

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
  const [, /* wpVersion */ setWpVersion] = useState<string | null>(null);

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
        setWpVersion(res.wp_version);
      } catch (error: any) {
        setNotice({
          type: "error",
          message:
            error?.message ||
            __("Failed to load settings.", "eventra-for-wpsignal"),
        });
      } finally {
        setIsConnecting(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await saveSettings({
        api_key: apiKey,
        yjs_provider_enabled: yjsProviderEnabled,
      });
      setSiteKey(res.site_key);
      setIsConnected(res.is_connected);
      setYjsProviderEnabled(res.yjs_provider_enabled);
      setNotice({
        type: "success",
        message: __("Settings saved.", "eventra-for-wpsignal"),
      });
    } catch {
      setNotice({
        type: "error",
        message: __("Failed to save settings.", "eventra-for-wpsignal"),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async (): Promise<void> => {
    setIsConnecting(true);
    setNotice(null);
    try {
      if (apiKey.length !== 64) {
        setNotice({
          type: "error",
          message: __("API Key is invalid, please include a valid API Key and try again.", "eventra-for-wpsignal"),
        });
        return;
      }
      const res = await connect(apiKey);
      setSiteKey(res.site_key);
      setIsConnected(true);
      setNotice({
        type: "success",
        message: res.message || __("Connected!", "eventra-for-wpsignal"),
      });
    } catch (error: any) {
      setNotice({
        type: "error",
        message:
          error?.message ||
          __(
            "Connection failed. Make sure your Server URL and API Key are saved.",
            "eventra-for-wpsignal",
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
          <Notice status={notice.type}>{notice.message}</Notice>
        ) : isConnecting ? (
          <Notice status="info">
            {__("Validating connection settings...", "eventra-for-wpsignal")}
          </Notice>
        ) : (
          isConnected && (
            <Notice status="success">
              &#10003; {__("Connected", "eventra-for-wpsignal")}
              {siteKey && (
                <>
                  {" "}
                  &mdash; <code>{siteKey}</code>
                </>
              )}
            </Notice>
          )
        )}
      </div>

      <TextControl
        className={`wpsignal-connection-input ${isConnecting ? ' is-loading' : ''}`}
        label={__("API Key", "eventra-for-wpsignal")}
        value={apiKey}
        minLength={64}
        maxLength={64}
        onChange={setApiKey}
        type="password"
        help={__(
          "Get your API key from your wpsignal.io dashboard.",
          "eventra-for-wpsignal",
        )}
        __nextHasNoMarginBottom
      />
      {!isConnecting &&
        (isRTCEnabled ? (
          <ToggleControl
            disabled={!isRTCEnabled}
            label={
              yjsProviderEnabled
                ? __(
                    "Disable WPSignal for real-time collaboration?",
                    "eventra-for-wpsignal",
                  )
                : __(
                    "Enable WPSignal for real-time collaboration?",
                    "eventra-for-wpsignal",
                  )
            }
            help={__(
              "Registers WPSignal as the Yjs sync provider in the block editor. Disable this to fall back to WordPress HTTP polling if WebSocket connections are unavailable.",
              "eventra-for-wpsignal",
            )}
            checked={yjsProviderEnabled}
            onChange={setYjsProviderEnabled}
            __nextHasNoMarginBottom
          />
        ) : (
          <Notice status="warning">
            {__(
              "Real-time collaboration is not enabled. Please enable it under Settings > Writing.",
              "eventra-for-wpsignal",
            )}
          </Notice>
        ))}

      <div className="wpsignal-connection-actions">
        <Button
          variant="primary"
          onClick={handleSave}
          isBusy={saving}
          disabled={!apiKey || saving || isConnecting || apiKey.length !== 64}
        >
          {__("Save Settings", "eventra-for-wpsignal")}
        </Button>
        <Button
          variant="secondary"
          onClick={handleConnect}
          isBusy={isConnecting}
          disabled={!apiKey || saving || isConnecting || apiKey.length !== 64}
        >
          {__("Connect to WPSignal", "eventra-for-wpsignal")}
        </Button>
      </div>
    </div>
  );
}
