/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { TabPanel } from "@wordpress/components";

/**
 * Internal dependencies.
 */
import { RtcTab } from "./RtcTab";
import { TriggersTab } from "./TriggersTab";
import { ConnectionTab } from "./ConnectionTab";
import { SettingsProvider, useSettings } from "./context";

/**
 * Settings App Tabs.
 */
const TABS = [
  {
    name: "connection",
    title: __("Connect", "wordsocket"),
    className: "wpsignal-tab-connection",
  },
  {
    name: "rtc",
    title: __("Realtime Collaboration", "wordsocket"),
    className: "wpsignal-tab-rtc",
  },
  {
    name: "triggers",
    title: __("Triggers", "wordsocket"),
    className: "wpsignal-tab-triggers",
  },
];

function SettingsTabs() {
  const { isConnected } = useSettings();
  const allowedTabs = isConnected
    ? TABS
    : TABS.map((tab) => ({ ...tab, disabled: tab.name !== "connection" }));
  return (
    <TabPanel className="wpsignal-settings-app" tabs={allowedTabs}>
      {(tab) => (
        <div className="wpsignal-tab-content">
          {tab.name === "connection" && <ConnectionTab />}
          {tab.name === "rtc" && <RtcTab />}
          {tab.name === "triggers" && <TriggersTab />}
        </div>
      )}
    </TabPanel>
  );
}

/**
 * Settings App.
 */
export function SettingsApp() {
  return (
    <SettingsProvider>
      <SettingsTabs />
    </SettingsProvider>
  );
}
