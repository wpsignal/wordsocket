/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { useEffect, useState } from "@wordpress/element";
import { SlotFillProvider, TabPanel } from "@wordpress/components";
import { PluginArea } from "@wordpress/plugins";

/**
 * Internal dependencies.
 */
import { TabSettings } from "./TabSettings";
import { TabTriggers } from "./TabTriggers";
import { TabConnection } from "./TabConnection";
import { TabExplorer } from "./TabExplorer";
import { TabExtensions } from "./TabExtensions";
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
  {
    name: "extensions",
    title: __("Extensions", "wordsocket"),
    className: "wpsignal-tab-extensions",
  },
];

/**
 * Tabs that stay usable before the site is connected. Extensions stays open
 * so the catalogue is visible to a user who has not connected yet; the tab
 * shows a "connect first" notice above installed panels in that state.
 */
const ALWAYS_ENABLED = ["connection", "extensions"];

/** The `tab` query parameter, so a tab can be linked to (admin.php?page=wordsocket&tab=extensions). */
function tabFromUrl(): string | undefined {
  const name = new URLSearchParams(window.location.search).get("tab");
  return TABS.some((tab) => tab.name === name) ? (name as string) : undefined;
}

function rememberTabInUrl(name: string): void {
  const url = new URL(window.location.href);
  if (name === TABS[0].name) {
    url.searchParams.delete("tab");
  } else {
    url.searchParams.set("tab", name);
  }
  window.history.replaceState(window.history.state, "", url.toString());
}

function TabsSettings() {
  const { isConnected, fetchStatus } = useSettings();
  // Until the first settings load answers, every tab is enabled so a linked
  // tab is selected straight away. If the site then turns out to be
  // disconnected, the tabs become disabled and TabPanel moves to Connect on
  // its own (it re-selects the first enabled tab); the URL follows below.
  // The initial fetch moves fetchStatus init -> connecting -> idle; later
  // connects reuse "connecting", so remember the first completion.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded && fetchStatus !== "init" && fetchStatus !== "connecting") {
      setLoaded(true);
    }
  }, [loaded, fetchStatus]);
  const loading = !loaded;
  const allowedTabs =
    loading || isConnected
      ? TABS
      : TABS.map((tab) => ({ ...tab, disabled: !ALWAYS_ENABLED.includes(tab.name) }));
  const requested = tabFromUrl();

  useEffect(() => {
    if (!loading && !isConnected && requested && !ALWAYS_ENABLED.includes(requested)) {
      rememberTabInUrl(TABS[0].name);
    }
  }, [loading, isConnected, requested]);

  return (
    <TabPanel
      className="wpsignal-settings-app"
      tabs={allowedTabs}
      initialTabName={requested}
      onSelect={rememberTabInUrl}
    >
      {(tab) => (
        <div className="wpsignal-tab-content">
          {tab.name === "connection" && <TabConnection title={tab.title} />}
          {tab.name === "settings" && <TabSettings title={tab.title} />}
          {tab.name === "triggers" && <TabTriggers title={tab.title} />}
          {tab.name === "explorer" && <TabExplorer title={tab.title} />}
          {tab.name === "extensions" && <TabExtensions title={tab.title} />}
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
    <SlotFillProvider>
      <SettingsProvider>
        <TabsSettings />
        {/* Extensions registered with `scope: "wordsocket"` render here, in
            every tab, so their fills reach the Extensions and Connect tabs. */}
        <PluginArea scope="wordsocket" />
      </SettingsProvider>
    </SlotFillProvider>
  );
}
