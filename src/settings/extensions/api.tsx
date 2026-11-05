/**
 * What `window.wordsocket` exposes to extensions. See src/types/extensions.d.ts.
 */

/**
 * WordPress dependencies.
 */
import { createSlotFill, Icon } from "@wordpress/components";
import { Card, Link, Stack, Text } from "@wordpress/ui";
import { useEffect, useState } from "@wordpress/element";

/**
 * Internal dependencies.
 */
import { useSettings } from "../context";
import { useTask } from "../useTask";

/**
 * Bumped on breaking changes to the API below.
 *
 * @since 0.21.0
 */
export const API_VERSION = 1;

const Panels = createSlotFill("WordSocketExtensionPanels");
const Status = createSlotFill("WordSocketConnectionStatus");

/**
 * Where the Extensions tab renders extension cards.
 *
 * @since 0.21.0
 */
export const ExtensionPanelSlot = Panels.Slot;
/**
 * Where the Connect tab renders extension status lines.
 *
 * @since 0.21.0
 */
export const ConnectionStatusSlot = Status.Slot;

/**
 * An extension's card on the Extensions tab.
 *
 * @since 0.21.0
 */
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
      <Card.Root className="wpsignal-extension" data-extension={name}>
        <Card.Header>
          <Stack
            direction="row"
            gap="sm"
            align="center"
            justify="space-between"
            wrap="wrap"
          >
            <Stack direction="row" gap="sm" align="center">
              {icon &&
                (typeof icon === "string" ? <Icon icon={icon as any} /> : icon)}
              <Card.Title render={<h3 />}>
                {firstPart}
                <span className="wpsignal-extension__brand">{secondPart}</span>
              </Card.Title>
            </Stack>
            {docsUrl && (
              <Link href={docsUrl} openInNewTab>
                Docs
              </Link>
            )}
          </Stack>
        </Card.Header>
        <Card.Content>
          <Stack direction="column" gap="md">
            {description && (
              <Text variant="body-sm" className="wpsignal-muted" render={<p />}>
                {description}
              </Text>
            )}
            {children}
          </Stack>
        </Card.Content>
      </Card.Root>
    </Panels.Fill>
  );
}

/**
 * Render a status line on the Connect tab.
 *
 * @since 0.21.0
 */
export function ConnectionStatusFill({
  children,
}: {
  children?: React.ReactNode;
}) {
  return <Status.Fill>{children}</Status.Fill>;
}

/**
 * The site's connection state, for an extension.
 *
 * @since 0.21.0
 */
export function useConnection(): WordSocketConnection {
  const { isConnected, siteKey, fetchStatus, lastError } = useSettings();
  return { isConnected, siteKey, fetchStatus, lastError };
}

/*
 * Tabs extensions add to the settings page.
 */
const tabs = new Map<string, WordSocketExtensionTab>();
const tabListeners = new Set<() => void>();

/**
 * Register an extension's settings tab.
 *
 * @since 0.28.0
 */
export function registerTab(tab: WordSocketExtensionTab): void {
  if (
    !tab ||
    typeof tab.name !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(tab.name)
  ) {
    throw new Error("wordsocket.registerTab: name must be a lowercase slug");
  }
  if (typeof tab.render !== "function") {
    throw new Error("wordsocket.registerTab: render must be a component");
  }
  tabs.set(tab.name, { ...tab, title: tab.title || tab.name });
  tabListeners.forEach((fn) => fn());
}

/**
 * The registered extension tabs, in registration order; re-renders on change.
 *
 * @since 0.28.0
 */
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

/**
 * The client's connection state, updated as it changes.
 *
 * @since 0.21.0
 */
export function useClientState(): WPSConnectionState | null {
  const [state, setState] = useState<WPSConnectionState | null>(
    window.WPS?.state ?? null,
  );
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
 *
 * @since 0.21.0
 */
export function installExtensionsApi(): void {
  const api: WordSocketExtensionsApi = {
    version: API_VERSION,
    ExtensionPanel,
    ConnectionStatusFill,
    registerTab,
    useConnection,
    useClientState,
    useTask,
  };
  window.wordsocket = api;
}
