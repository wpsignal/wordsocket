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
import { __experimentalTruncate as Truncate } from "@wordpress/components";

/**
 * External dependencies.
 */
import type { ReactNode } from "react";

/**
 * Internal dependencies.
 */
import type { NoticeState } from "./types";
import { disconnect, getSettings } from "./api";

const { isSsl = false } = window.wpSignalConfig ?? {};

type FetchStatus =
  | "init"
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "disconnecting"
  | "error";

type TabsCached = {
  connection: any | null;
  rtc: any | null;
  triggers: any[];
  explorer: any | null;
};

type SettingsState = {
  apiKey: string;
  siteKey: string;
  isConnected: boolean;
  noticeMessage: NoticeState | null;
  connectionType: "automatic" | "manual" | null;
  fetchStatus: FetchStatus;
  yjsProviderEnabled: boolean;
  tabsCache: TabsCached;
  setTabsCache: (tabs: TabsCached) => void;
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
  isConnected: false,
  noticeMessage: null,
  connectionType: isSsl ? "automatic" : "manual",
  fetchStatus: "init",
  yjsProviderEnabled: false,
  tabsCache: {
    connection: null,
    rtc: null,
    triggers: [],
    explorer: null,
  },
  setTabsCache: () => {},
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
        <Truncate limit={16} ellipsizeMode="middle" ellipsis="...">
          {siteKey}
        </Truncate>
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
  const [tabsCache, setTabsCache] = useState<TabsCached>({
    connection: null,
    rtc: null,
    triggers: [],
    explorer: null,
  });
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_STATE);

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
      value={{
        ...settings,
        setSetting,
        handleDisconnect,
        tabsCache,
        setTabsCache,
      }}
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
