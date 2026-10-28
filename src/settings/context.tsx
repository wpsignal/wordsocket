/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import {
  useState,
  useContext,
  createContext,
  useCallback,
  useEffect,
  useMemo,
} from "@wordpress/element";
import { __experimentalTruncate as Truncate } from "@wordpress/components";

/**
 * External dependencies.
 */
import type { ReactNode } from "react";

/**
 * Internal dependencies.
 */
import { useTask } from "./useTask";
import type { NoticeState, Trigger } from "./types";
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

/** What a tab keeps across tab switches: the Triggers tab's rows, so a return does not refetch them. */
type TabsCached = {
  triggers: Trigger[];
};

type SettingsState = {
  apiKey: string;
  siteKey: string;
  isConnected: boolean;
  noticeMessage: NoticeState | null;
  connectionType: "automatic" | "manual" | null;
  fetchStatus: FetchStatus;
  /** Last publish failure reported by the server-side publisher, if any. */
  lastError: {
    code: string;
    message: string;
    detail: string;
    time: number;
  } | null;
  /** The Connect tab is showing the "are you sure" row for Disconnect. */
  confirmDisconnect: boolean;
  yjsProviderEnabled: boolean;
  /** The Triggers and Explorer tabs are shown. */
  developerMode: boolean;
  /** Journeys are kept on the site. */
  historyEnabled: boolean;
  /** How many months a journey is kept. */
  journeysRetentionMonths: number;
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
  lastError: null,
  confirmDisconnect: false,
  yjsProviderEnabled: false,
  // Seeded from PHP so a link to a developer tab is honoured on first render.
  developerMode: window.wpsignalSettings?.developerMode === true,
  historyEnabled: window.wpsignalSettings?.history?.enabled === true,
  journeysRetentionMonths: 3,
  tabsCache: { triggers: [] },
  setTabsCache: () => {},
  setSetting: () => {},
  handleDisconnect: async () => {},
  successMessage,
};

/** Connected notice shown in the settings header after a successful connect. */
function successMessage(siteKey: string): React.ReactNode {
  return (
    <>
      &#10003; {__("Connected:", "wordsocket")}{" "}
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

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [tabsCache, setTabsCache] = useState<TabsCached>({ triggers: [] });
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_STATE);

  const setSetting = useCallback(
    (key: keyof SettingsState, value: SettingsState[keyof SettingsState]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  useEffect(() => {
    const fetchSettings = async () => {
      setSetting("fetchStatus", "connecting");
      try {
        const res = await getSettings();
        setSetting("apiKey", res.api_key);
        setSetting("siteKey", res.site_key);
        setSetting("isConnected", res.is_connected);
        setSetting("yjsProviderEnabled", res.yjs_provider_enabled);
        setSetting("developerMode", res.developer_mode);
        setSetting("historyEnabled", res.history_enabled === true);
        setSetting("journeysRetentionMonths", Number(res.journeys_retention_months) || 3);
        setSetting("lastError", res.last_error ?? null);
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
  }, [setSetting]);

  const disconnectTask = useTask(disconnect, {
    success: __("Disconnected from WPSignal.", "wordsocket"),
    error: __("Disconnect failed. Please try again.", "wordsocket"),
    onSuccess: () => {
      setSetting("apiKey", "");
      setSetting("siteKey", "");
      setSetting("isConnected", false);
      setSetting("fetchStatus", "disconnected");
    },
    /*
     * The server refused or was unreachable: credentials are still stored, so the site stays
     * connected and the user can retry.
     */
    onError: () => setSetting("fetchStatus", "idle"),
  });

  const runDisconnect = disconnectTask.run;
  const handleDisconnect = useCallback(async (): Promise<void> => {
    /*
     * The confirmation row has served its purpose once Disconnect is clicked; clearing it here
     * means a later reconnect starts from the plain button.
     */
    setSetting("confirmDisconnect", false);
    setSetting("fetchStatus", "disconnecting");
    setSetting("noticeMessage", null);
    await runDisconnect();
  }, [runDisconnect, setSetting]);

  /* One value per change of state, so every tab and extension does not re-render per keystroke elsewhere. */
  const value = useMemo(
    () => ({
      ...settings,
      setSetting,
      handleDisconnect,
      tabsCache,
      setTabsCache,
    }),
    [settings, setSetting, handleDisconnect, tabsCache],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return ctx;
}
