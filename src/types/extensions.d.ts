/**
 * The API WordSocket exposes to extensions on `window.wordsocket`.
 *
 * An extension is a separate plugin whose settings render inside WordSocket's
 * settings page. Its script is enqueued on the `wordsocket_settings_enqueue`
 * action with `wpsignal-settings` as a dependency, registers with
 * `wp.plugins.registerPlugin( slug, { scope: 'wordsocket', render } )`, and
 * renders an `ExtensionPanel` from `render`. Both bundles share React through
 * the `wp.*` globals, which is what lets one plugin's components render inside
 * another's tree.
 */

interface WordSocketExtensionPanelProps {
	/** Extension slug, matching the PHP registration. */
	name: string;
	title: string;
	description?: string;
	/** Dashicon name or a React element for the card header. */
	icon?: string | React.ReactNode;
	docsUrl?: string;
	children?: React.ReactNode;
}

interface WordSocketConnection {
	isConnected: boolean;
	siteKey: string;
	fetchStatus: string;
	lastError: { code: string; message: string; detail: string; time: number } | null;
}

/** A tab an extension adds to WordSocket's settings page, after the built-in ones. */
interface WordSocketExtensionTab {
	/** Lowercase slug, unique across extensions; becomes `&tab=<name>` and the `wpsignal-tab-<name>` class. */
	name: string;
	title: string;
	/** Renders the tab's content. May use the hooks below and `wp.components`. */
	render: React.ComponentType;
}

interface WordSocketExtensionsApi {
	/** API version, bumped on breaking changes. */
	version: number;
	/** A card in the Extensions tab. One per extension. */
	ExtensionPanel: React.ComponentType< WordSocketExtensionPanelProps >;
	/** One line rendered in the Connect tab's status area (for example "Live stock paused"). */
	ConnectionStatusFill: React.ComponentType< { children?: React.ReactNode } >;
	/**
	 * Add a tab to the settings page. Call it at module evaluation, right
	 * after the `wpsignal-settings` script: the app mounts then. Extension tabs
	 * are disabled while the site is disconnected, like Settings and Triggers.
	 */
	registerTab: ( tab: WordSocketExtensionTab ) => void;
	/** The settings app's view of the WordSocket connection. */
	useConnection: () => WordSocketConnection;
	/** `window.WPS.state`, subscribed through `onStateChange`. */
	useClientState: () => WPSConnectionState | null;
}

interface WordSocketExtensionInfo {
	slug: string;
	title: string;
	description: string;
	version: string;
	docs_url: string;
	installed: boolean;
	/** Catalogue entries only: whether the extension can be installed today. */
	available?: boolean;
	/** Labels of required plugins that are not active. */
	missing: string[];
}
