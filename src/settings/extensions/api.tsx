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
  return (
    <Panels.Fill>
      <Card className="wpsignal-extension" data-extension={name}>
        <CardHeader className="wpsignal-extension__header">
          <div className="wpsignal-extension__title">
            {icon && (typeof icon === "string" ? <Icon icon={icon as any} /> : icon)}
            <h3>{title}</h3>
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
    useConnection,
    useClientState,
  };
  window.wordsocket = api;
}
