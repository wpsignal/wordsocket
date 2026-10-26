/**
 * WordPress dependencies.
 */
import domReady from "@wordpress/dom-ready";
import { createRoot } from "@wordpress/element";
/* Defines the --wpds-* tokens on :root for the whole page. */
import "@wordpress/theme/design-tokens.css";

/**
 * Internal dependencies.
 */
import { SettingsApp } from "./AppSettings";
import { installExtensionsApi } from "./extensions/api";
import { installHistoryProvider } from "./history";
import "./index.css";

// Before anything renders: extension scripts run right after this bundle.
installExtensionsApi();
installHistoryProvider();

/* Mount after every footer script has run, so extension tabs exist before TabPanel reads the URL. */
domReady(() => {
  const root = document.getElementById("wpsignal-settings-root");
  if (root) {
    createRoot(root).render(<SettingsApp />);
  }
});
