/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { useEffect, useRef, useState } from "@wordpress/element";
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
import { TabRules } from "./TabRules";
import { TabJourneys } from "./TabJourneys";
import { Snackbars } from "./Snackbars";
import { SettingsProvider, useSettings } from "./context";
import { useExtensionTabs } from "./extensions/api";
import { clearUrlParams, onNavigate, writeUrlParam } from "./useUrlParam";
import { UnsavedChangesProvider } from "./useUnsavedChanges";

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
    name: "moments",
    title: __("Moments", "wordsocket"),
    className: "wpsignal-tab-moments",
  },
  {
    name: "journeys",
    title: __("Journeys", "wordsocket"),
    className: "wpsignal-tab-journeys",
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
 * Tabs usable before the site is connected; Extensions stays open so the catalogue is visible, with
 * a connect-first notice above installed panels.
 */
const ALWAYS_ENABLED = ["connection", "extensions"];

/**
 * Tabs for people writing code against the site: listed only in developer mode (the Settings tab's
 * switch).
 */
const DEVELOPER_TABS = ["triggers", "explorer"];

/**
 * The `tab` query parameter, so a tab can be linked to (admin.php?page=wordsocket&tab=extensions).
 */
function tabFromUrl(names: string[]): string | undefined {
  const name = new URLSearchParams(window.location.search).get("tab");
  return name && names.includes(name) ? name : undefined;
}

function rememberTabInUrl(name: string): void {
  clearUrlParams(["page"]);
  writeUrlParam("tab", name === TABS[0].name ? null : name);
}

function TabsSettings() {
  const { isConnected, fetchStatus, developerMode } = useSettings();
  /*
   * Every tab is enabled until the first settings load answers, so a linked tab opens at once; if
   * the site is then disconnected the tabs disable and TabPanel moves to Connect. Later connects
   * reuse "connecting", so the first completion is remembered.
   */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded && fetchStatus !== "init" && fetchStatus !== "connecting") {
      setLoaded(true);
    }
  }, [loaded, fetchStatus]);
  const loading = !loaded;
  /*
   * Extension tabs come after the built-in ones and need a connected site.
   */
  const extensionTabs = useExtensionTabs();
  const allTabs = [
    ...TABS.filter(
      (tab) => developerMode || !DEVELOPER_TABS.includes(tab.name),
    ),
    ...extensionTabs.map((tab) => ({
      name: tab.name,
      title: tab.title,
      className: `wpsignal-tab-${tab.name}`,
    })),
  ];
  const allowedTabs =
    loading || isConnected
      ? allTabs
      : allTabs.map((tab) => ({
          ...tab,
          disabled: !ALWAYS_ENABLED.includes(tab.name),
        }));
  const requested = tabFromUrl(allTabs.map((tab) => tab.name));
  /*
   * TabPanel picks its tab once, from `initialTabName`, so Back or Forward onto another tab
   * remounts it (`epoch`); `selected` is what is on screen, so the mount-time `onSelect` and a
   * step within one tab leave the URL alone.
   */
  const selected = useRef(requested ?? TABS[0].name);
  const [epoch, setEpoch] = useState(0);
  useEffect(
    () =>
      onNavigate(() => {
        const name = tabFromUrl(allTabs.map((tab) => tab.name)) ?? TABS[0].name;
        if (name === selected.current) return;
        selected.current = name;
        setEpoch((n) => n + 1);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allTabs.map((tab) => tab.name).join()],
  );
  const onSelect = (name: string) => {
    if (name === selected.current) return;
    selected.current = name;
    rememberTabInUrl(name);
  };

  useEffect(() => {
    if (
      !loading &&
      !isConnected &&
      requested &&
      !ALWAYS_ENABLED.includes(requested)
    ) {
      rememberTabInUrl(TABS[0].name);
    }
  }, [loading, isConnected, requested]);

  useEffect(() => {
    // A link to a developer tab while developer mode is off lands on Connect; the URL follows.
    const linked = new URLSearchParams(window.location.search).get("tab");
    if (!developerMode && linked && DEVELOPER_TABS.includes(linked)) {
      rememberTabInUrl(TABS[0].name);
    }
  }, [developerMode]);

  return (
    <TabPanel
      key={epoch}
      className="wpsignal-settings-app"
      tabs={allowedTabs}
      initialTabName={requested}
      onSelect={onSelect}
    >
      {(tab) => (
        <div className="wpsignal-tab-content">
          {tab.name === "connection" && <TabConnection title={tab.title} />}
          {tab.name === "settings" && <TabSettings title={tab.title} />}
          {tab.name === "moments" && <TabRules title={tab.title} />}
          {tab.name === "journeys" && <TabJourneys title={tab.title} />}
          {tab.name === "triggers" && <TabTriggers title={tab.title} />}
          {tab.name === "explorer" && <TabExplorer title={tab.title} />}
          {tab.name === "extensions" && <TabExtensions title={tab.title} />}
          {extensionTabs
            .filter((ext) => ext.name === tab.name)
            .map((ext) => (
              <ext.render key={ext.name} />
            ))}
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
        <UnsavedChangesProvider>
          <TabsSettings />
        </UnsavedChangesProvider>
        {/* Extensions registered with `scope: "wordsocket"` render here, in
            every tab, so their fills reach the Extensions and Connect tabs. */}
        <PluginArea scope="wordsocket" />
        <Snackbars />
      </SettingsProvider>
    </SlotFillProvider>
  );
}
