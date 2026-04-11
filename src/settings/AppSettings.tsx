/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { TabPanel } from "@wordpress/components";

/**
 * Internal dependencies.
 */
import { TabSettings } from "./TabSettings";
import { TabTriggers } from "./TabTriggers";
import { TabConnection } from "./TabConnection";
import { TabExplorer } from "./TabExplorer";
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
    name: "settings",
    title: __("Settings", "wordsocket"),
    className: "wpsignal-tab-settings",
  },
  {
    name: "triggers",
    title: __("Triggers", "wordsocket"),
    className: "wpsignal-tab-triggers",
  },
  {
    name: "explorer",
    title: __("Explorer", "wordsocket"),
    className: "wpsignal-tab-explorer",
  },
];

function TabsSettings() {
  const { isConnected } = useSettings();
  const allowedTabs = isConnected
    ? TABS
    : TABS.map((tab) => ({ ...tab, disabled: tab.name !== "connection" }));
  return (
    <TabPanel className="wpsignal-settings-app" tabs={allowedTabs}>
      {(tab) => (
        <div className="wpsignal-tab-content">
          {tab.name === "connection" && <TabConnection title={tab.title} />}
          {tab.name === "settings" && <TabSettings title={tab.title} />}
          {tab.name === "triggers" && <TabTriggers title={tab.title} />}
          {tab.name === "explorer" && <TabExplorer title={tab.title} />}
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
      <TabsSettings />
    </SettingsProvider>
  );
}
