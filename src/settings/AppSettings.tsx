/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { useEffect, useState } from "@wordpress/element";
import { SlotFillProvider } from "@wordpress/components";
import { PluginArea } from "@wordpress/plugins";
import { Badge, Tabs } from "@wordpress/ui";

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
import { UnsavedChangesProvider, useLeaveGuard } from "./useUnsavedChanges";

interface Tab {
  name: string;
  title: string;
  className: string;
  /** Shows a "New" badge beside the title. */
  new?: boolean;
}

/**
 * Settings App Tabs.
 */
const TABS: Tab[] = [
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
    new: true,
  },
  {
    name: "journeys",
    title: __("Journeys", "wordsocket"),
    className: "wpsignal-tab-journeys",
    new: true,
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

/**
 * The tab list and the open tab's content.
 *
 * @since 0.31.0 `@wordpress/ui` Tabs, controlled, so a switch away from unsaved changes is asked
 *               through the leave guard and a "New" badge marks a tab.
 */
function TabsSettings() {
  const { isConnected, fetchStatus, developerMode } = useSettings();
  const guard = useLeaveGuard();
  /*
   * Every tab is enabled until the first settings load answers, so a linked tab opens at once; if
   * the site is then disconnected the tabs disable and the open one falls back to Connect. Later
   * connects reuse "connecting", so the first completion is remembered.
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
  const allTabs: Tab[] = [
    ...TABS.filter(
      (tab) => developerMode || !DEVELOPER_TABS.includes(tab.name),
    ),
    ...extensionTabs.map((tab) => ({
      name: tab.name,
      title: tab.title,
      new: tab.new ?? false,
      className: `wpsignal-tab-${tab.name}`,
    })),
  ];
  const names = allTabs.map((tab) => tab.name);
  const enabled = (name: string) =>
    loading || isConnected || ALWAYS_ENABLED.includes(name);

  /* The open tab: the URL's on load and after Back or Forward, else Connect. */
  const [selected, setSelected] = useState(
    () => tabFromUrl(names) ?? TABS[0].name,
  );
  useEffect(
    () => onNavigate(() => setSelected(tabFromUrl(names) ?? TABS[0].name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [names.join()],
  );
  /* A tab no longer offered (disconnected, developer mode off, an extension gone) falls back to Connect, URL included. */
  useEffect(() => {
    if (names.includes(selected) && enabled(selected)) return;
    setSelected(TABS[0].name);
    rememberTabInUrl(TABS[0].name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join(), selected, loading, isConnected]);

  const select = (name: string) => {
    if (name === selected || !names.includes(name)) return;
    guard(() => {
      setSelected(name);
      rememberTabInUrl(name);
    });
  };

  const content = (tab: Tab) => {
    switch (tab.name) {
      case "connection":
        return <TabConnection title={tab.title} />;
      case "settings":
        return <TabSettings title={tab.title} />;
      case "moments":
        return <TabRules title={tab.title} />;
      case "journeys":
        return <TabJourneys title={tab.title} />;
      case "triggers":
        return <TabTriggers title={tab.title} />;
      case "explorer":
        return <TabExplorer title={tab.title} />;
      case "extensions":
        return <TabExtensions title={tab.title} />;
      default: {
        const ext = extensionTabs.find((e) => e.name === tab.name);
        return ext ? <ext.render /> : null;
      }
    }
  };

  return (
    <div
      style={{
        overflow: "auto",
        boxSizing: "content-box",
      }}
    >
      <Tabs.Root
        className="wpsignal-settings-app"
        value={selected}
        onValueChange={(value) => select(String(value))}
      >
        <Tabs.List
          className="wpsignal-settings-app__tabs"
          style={{
            maxWidth: "100%",
          }}
        >
          {allTabs.map((tab) => (
            <Tabs.Tab
              key={tab.name}
              value={tab.name}
              className={tab.className}
              disabled={!enabled(tab.name)}
            >
              {tab.title}
              {tab.new && (
                <Badge intent="informational" className="wpsignal-tab-new">
                  {__("Beta", "wordsocket")}
                </Badge>
              )}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {allTabs.map((tab) => (
          <Tabs.Panel
            key={tab.name}
            value={tab.name}
            tabIndex={-1}
            className="wpsignal-tab-content"
          >
            {content(tab)}
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </div>
  );
}

/**
 * Settings App.
 *
 * @since 0.7.0
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
