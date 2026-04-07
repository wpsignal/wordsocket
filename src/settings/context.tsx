/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import {
  useState,
  useContext,
  createContext,
  useEffect,
} from "@wordpress/element";

/**
 * External dependencies.
 */
import type { ReactNode } from "react";

/**
 * Internal dependencies.
 */
import type { NoticeState } from "./types";
import { truncate } from "../utils";
import { disconnect, getSettings } from "./api";

const {
  isSsl = false,
} = window.wpSignalConfig ?? {};

type FetchStatus = "idle" | "connecting" | "connected" | "disconnected" | "disconnecting" | "error";

type SettingsState = {
  apiKey: string;
  siteKey: string;
  isFetching: boolean;
  isConnected: boolean;
  noticeMessage: NoticeState | null;
  connectionType: "automatic" | "manual" | null;
  fetchStatus: FetchStatus;
  yjsProviderEnabled: boolean;
  setSetting: (
    key: keyof Omit<SettingsState, "setSetting">,
    value: Omit<SettingsState, "setSetting">[keyof Omit<
      SettingsState,
      "setSetting"
    >],
  ) => void;
  handleDisconnect: () => Promise<void>;
  successMessage: (siteKey: string) => React.ReactNode;
};

const DEFAULT_STATE: SettingsState = {
  apiKey: "",
  siteKey: "",
  isFetching: false,
  isConnected: false,
  noticeMessage: null,
  connectionType: isSsl ? "automatic" : "manual",
  fetchStatus: "idle",
  yjsProviderEnabled: false,
  setSetting: () => {},
  handleDisconnect: async () => {},
  successMessage,
};

/**
 * Successful 'Connected' message.
 *
 * @param siteKey - The site key.
 * @returns The success message.
 */
function successMessage(siteKey: string): React.ReactNode {
  return (
    <>
      &#10003; {__("Connected", "wordsocket")} &mdash;{" "}
      <code>
        {truncate(siteKey, 8, false)}...
        {truncate(siteKey, 8, true)}
      </code>
    </>
  );
}

/**
 * Settings context.
 */
const SettingsContext = createContext<SettingsState>(DEFAULT_STATE);

/**
 * Settings provider.
 * 
 * @TODO: add tab state to avoid unnecessary requests between tab changes.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_STATE);

  // Show a notice from the OAuth callback redirect (wps_notice URL param).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wpsNotice = params.get("wps_notice");
    if (wpsNotice === "connected" && settings.siteKey) {
      setSetting("noticeMessage", {
        type: "success",
        message: successMessage(settings.siteKey),
      });
    }
  }, [settings.siteKey]);

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

  useEffect(() => {
    const fetchSettings = async () => {
      setSetting("fetchStatus", "connecting");
      try {
        const res = await getSettings();
        setSetting("apiKey", res.api_key);
        setSetting("siteKey", res.site_key);
        setSetting("isConnected", res.is_connected);
        setSetting("yjsProviderEnabled", res.yjs_provider_enabled);
      } catch (error: any) {
        setSetting("noticeMessage", {
          type: "error",
          message:
            error?.message || __("Failed to load settings.", "wordsocket"),
        });
      } finally {
        setSetting("fetchStatus", "idle");
      }
    };
    fetchSettings();
  }, []);

  /**
   * Set a setting.
   *
   * @param key - The key of the setting to set.
   * @param value - The value of the setting to set.
   */
  function setSetting(
    key: keyof SettingsState,
    value: SettingsState[keyof SettingsState],
  ) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  const handleDisconnect = async (): Promise<void> => {
    setSetting("fetchStatus", "disconnecting");
    setSetting("noticeMessage", null);
    try {
      await disconnect();
    } catch (error: any) {
      setSetting("noticeMessage", {
        type: "error",
        message:
          error?.message ||
          __("Disconnect failed. Please try again.", "wordsocket"),
      });
    } finally {
      setSetting("apiKey", "");
      setSetting("siteKey", "");
      setSetting("isConnected", false);
      setSetting("fetchStatus", "disconnected");
    }
  };

  return (
    <SettingsContext.Provider
      value={{ ...settings, setSetting, handleDisconnect }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

/**
 * Use settings.
 *
 * @returns The settings.
 */
export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return ctx;
}
