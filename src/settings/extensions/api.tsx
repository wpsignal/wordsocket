/**
 * What `window.wordsocket` exposes to extensions. See src/types/extensions.d.ts.
 */

/**
 * WordPress dependencies.
 */
import { createSlotFill, Card, CardBody, CardHeader, Icon } from "@wordpress/components";
import { useEffect, useState } from "@wordpress/element";

/**
 * Internal dependencies.
 */
import { useSettings } from "../context";

/** Bumped on breaking changes to the API below. */
export const API_VERSION = 1;

const Panels = createSlotFill("WordSocketExtensionPanels");
const Status = createSlotFill("WordSocketConnectionStatus");

/** Where the Extensions tab renders extension cards. */
export const ExtensionPanelSlot = Panels.Slot;
/** Where the Connect tab renders extension status lines. */
export const ConnectionStatusSlot = Status.Slot;

export function ExtensionPanel({
  name,
  title,
  description,
  icon,
  docsUrl,
  children,
}: WordSocketExtensionPanelProps) {
  // Split title into two parts the first part and then the "Socket" part
  const titleParts = title.split(/(?=[A-Z])/);
  const [firstPart, secondPart] = titleParts;
  return (
    <Panels.Fill>
      <Card className="wpsignal-extension" data-extension={name}>
        <CardHeader className="wpsignal-extension__header">
          <div className="wpsignal-extension__title">
            {icon && (typeof icon === "string" ? <Icon icon={icon as any} /> : icon)}
            <h3>{firstPart}<span style={{ opacity: "0.6", color: "var(--wp-admin-theme-color, currentColor)" }}>{secondPart}</span></h3>
          </div>
          {docsUrl && (
            <a href={docsUrl} target="_blank" rel="noopener noreferrer">
              Docs
            </a>
          )}
        </CardHeader>
        <CardBody>
          {description && <p className="wpsignal-extension__description">{description}</p>}
          {children}
        </CardBody>
      </Card>
    </Panels.Fill>
  );
}

export function ConnectionStatusFill({ children }: { children?: React.ReactNode }) {
  return <Status.Fill>{children}</Status.Fill>;
}

export function useConnection(): WordSocketConnection {
  const { isConnected, siteKey, fetchStatus, lastError } = useSettings();
  return { isConnected, siteKey, fetchStatus, lastError };
}

/*
 * Tabs extensions add to the settings page. A registry rather than a slot:
 * TabPanel wants its tab list up front, and an extension script runs right
 * after this bundle, before React's first render, so registering at module
 * evaluation is early enough. Listeners cover the late case by re-rendering
 * the app when a tab arrives after mount.
 */
const tabs = new Map<string, WordSocketExtensionTab>();
const tabListeners = new Set<() => void>();

export function registerTab(tab: WordSocketExtensionTab): void {
  if (!tab || typeof tab.name !== "string" || !/^[a-z][a-z0-9-]*$/.test(tab.name)) {
    throw new Error("wordsocket.registerTab: name must be a lowercase slug");
  }
  if (typeof tab.render !== "function") {
    throw new Error("wordsocket.registerTab: render must be a component");
  }
  tabs.set(tab.name, { ...tab, title: tab.title || tab.name });
  tabListeners.forEach((fn) => fn());
}

/** The registered extension tabs, in registration order; re-renders on change. */
export function useExtensionTabs(): WordSocketExtensionTab[] {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((n) => n + 1);
    tabListeners.add(bump);
    return () => {
      tabListeners.delete(bump);
    };
  }, []);
  return Array.from(tabs.values());
}

export function useClientState(): WPSConnectionState | null {
  const [state, setState] = useState<WPSConnectionState | null>(window.WPS?.state ?? null);
  useEffect(() => {
    const wps = window.WPS;
    if (!wps) return undefined;
    setState(wps.state);
    return wps.onStateChange(setState);
  }, []);
  return state;
}

/**
 * Publish the API. Runs at module evaluation, before the app mounts, so an
 * extension script that depends on `wpsignal-settings` finds it immediately.
 */
export function installExtensionsApi(): void {
  const api: WordSocketExtensionsApi = {
    version: API_VERSION,
    ExtensionPanel,
    ConnectionStatusFill,
    registerTab,
    useConnection,
    useClientState,
  };
  window.wordsocket = api;
}
