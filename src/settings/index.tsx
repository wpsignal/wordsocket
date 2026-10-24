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
import "./index.css";

// Before anything renders: extension scripts run right after this bundle.
installExtensionsApi();

/*
 * Mount once every footer script has run, so a tab an extension registers is there when
 * `TabPanel` picks its initial tab from the URL. Rendering at evaluation raced it: React's first
 * render is a scheduled task the browser could run between this script and the extension's, and
 * `tab=shopsocket` then landed on Connect four loads in five (2026-10-24).
 */
domReady(() => {
  const root = document.getElementById("wpsignal-settings-root");
  if (root) {
    createRoot(root).render(<SettingsApp />);
  }
});
