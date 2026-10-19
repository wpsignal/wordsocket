/** The relay endpoints, built in PHP by `Config::endpoints()`; the browser only appends the query. */
interface WpSignalEndpoints {
	/** WebSocket endpoint, e.g. `wss://api.wpsignal.io/ws`. */
	ws: string;
	/** Server-Sent Events endpoint, e.g. `https://api.wpsignal.io/sse`. */
	sse: string;
}

/** Localized by class-wpsignal-client.php */
interface WpSignalConfig {
	/** WordPress version. */
	wpVersion: number;
	/** Whether to use constant credentials. */
	isConstant: boolean;
	/** Whether the WP sync engine is present (Gutenberg plugin until RTC ships in core). */
	isWpRtcAvailable: boolean;
	/** Whether real-time collaboration is enabled (Gutenberg > Experiments toggle, via wp_is_collaboration_enabled()). */
	isWpRtcEnabled: boolean;
	/** Whether to use SSL. */
	isSsl: boolean;
	/** WPSignal dashboard URL (settings page only; derived from the server base URL). */
	dashboardUrl?: string;
	/** Whether to enable debug mode. */
	isDebug: boolean;
	/** WordPress REST URL. */
	restUrl: string;
	/** WordPress REST nonce. Printed for logged-in visitors only: a cached guest page must carry none. */
	nonce?: string;
	/** WPSignal server URL. */
	baseUrl: string;
	/** Relay endpoints from PHP. Absent only on a page cached before 0.25 (see `relayEndpoints`). */
	endpoints?: WpSignalEndpoints;
	/** Server-side minted token (present on first load; absent on refresh calls). */
	token?: string;
	channels?: string[];
	exp?: number;
	/** Base64-encoded raw AES-256 key for decrypting incoming "encrypted" messages. Never sent to WPSignal. */
	encryptionKey?: string;
	/** Force use of SSE instead of WebSocket. */
	forceSSE?: boolean;
	/** This page's step and the report routes, for `WPS.presence.track()` (0.30). Absent on a page cached before it. */
	presence?: WpSignalPresenceConfig;
}

/** Printed by class-wpsignal-client.php from `Presence::config()`. */
interface WpSignalPresenceConfig {
	/** The page's kind: a post type, a taxonomy, or `home`, `search`, `archive`, `other`, `admin` (the `wpsignal_page_step` filter). */
	kind: string;
	/** The post or term id, 0 when the kind has none. */
	id: number;
	/** `POST /wpsignal/v1/visit`. */
	visitUrl: string;
	/** `POST /wpsignal/v1/leave`. */
	leaveUrl: string;
}

/** Localized by class-wpsignal-admin-page.php (Settings React app) */
interface WpSignalSettings {
	/** URL for the connection endpoint. */
	connectUrl: string;
	/** URL for the OAuth start endpoint. */
	oauthStartUrl: string;
	/** URL for the REST endpoint. */
	restUrl: string;
	/** wp_rest nonce for authenticated REST requests. */
	nonce: string;
	/** Array of public post type objects (value, label) for trigger dropdowns. */
	postTypes: Array< { value: string; label: string } >;
	/** WPSignal server base URL. */
	baseUrl: string;
	/** Relay endpoints from PHP, for the Explorer's socket. */
	endpoints?: WpSignalEndpoints;
	/** WPSignal dashboard URL, derived from baseUrl. */
	dashboardUrl: string;
	/** Stored site key (set after either connection flow completes). */
	siteKey: string;
	/** Array of registered trigger instances. */
	triggers: WpSignalTriggerRow[];
	/** Real-time collaboration on this site: Gutenberg present, and its experiment switched on. */
	rtc?: { available: boolean; enabled: boolean };
	/** Whether the Triggers and Explorer tabs are shown (the Settings tab's "Developer tools" switch). */
	developerMode?: boolean;
}

/** Localized by class-wpsignal-client.php (enqueue_yjs_provider) */
interface WpSignalYjsConfig {
	/** Channel prefix for Yjs channels, e.g. `site:{site_id}:yjs:`. Keeps Yjs channels within the JWT's allowed_channel_prefixes. */
	channelPrefix: string;
}

/** Localized by class-wpsignal-admin-page.php (added to wpsignalSettings for the Explorer tab) */
interface WpSignalTriggerRow {
	event: string;
	hook: string;
	priority: number;
	args: number;
	channel: string;
	condition: boolean;
}

type WPSMessageHandler = ( event: string, data: Record< string, unknown >, channel: string ) => void;
type WPSEventHandler = ( data: Record< string, unknown >, channel: string ) => void;
/** Handler for incoming binary WebSocket frames (e.g. Yjs updates). */
type WPSBinaryHandler = ( channel: string, data: Uint8Array ) => void;
type WPSTransportName = 'ws' | 'sse';
type WPSStatus = {
	name: WPSTransportName | null;
	connected: boolean;
	readyState: number | null;
	canPublish: boolean;
	canPublishBinary: boolean;
	/** Timestamp (ms) of the last inbound frame (including server pings); null when unknown or on SSE. */
	lastMessageAt: number | null;
	/** Why the connection is down, if it is; cleared on the next successful open. */
	lastError: WPSConnectionError | null;
	/** Consecutive failed connection attempts since the last successful open. */
	failures: number;
};

/**
 * Error codes shared with the Yjs provider. They mirror @wordpress/sync's
 * ConnectionErrorCode so the editor can pick its copy without translation.
 */
type WPSConnectionErrorCode =
	| 'authentication-failed'
	| 'connection-expired'
	| 'connection-limit-exceeded'
	| 'document-size-limit-exceeded'
	| 'protocol-mismatch'
	| 'unknown-error';

interface WPSConnectionError {
	code: WPSConnectionErrorCode;
	message: string;
}

/** Full connection state delivered to `onStateChange` handlers. */
interface WPSConnectionState {
	connected: boolean;
	transport: WPSTransportName | null;
	/** Present while disconnected because of an error. */
	error?: WPSConnectionError;
	/** Present while an automatic retry is scheduled: milliseconds until it fires. */
	retryInMs?: number;
	/** Consecutive failed attempts since the last successful open. */
	failures: number;
}

/** Options for `WPS.presence.track()`. */
interface WPSTrackOptions {
	/** The plugin's own fields, carried in presence state and in every report (ShopSocket's cart id). */
	state?: Record< string, unknown >;
	/** Whether to report visits and leaves to WordPress. Default true; false for a live-only board. */
	report?: boolean;
}

/** What `WPS.presence.track()` returns. */
interface WPSPresenceTracker {
	/** This browser's visitor id, the same `WPS.visitorId()` gives. */
	readonly visitor: string;
	/** This visit's journey id, a v4 UUID; a new one after 30 minutes without an arrival. */
	journeyId(): string;
	/** The journey so far: `kind:id:ms` steps joined by `>`, the open step's time included. */
	journey(): string;
	/** Replace the plugin's fields; presence is announced again at once. */
	update( state: Record< string, unknown > ): void;
	/** Called after every change to the journey (a step, away, back, a new visit). Returns the unsubscribe. */
	onChange( handler: ( journey: string, journeyId: string ) => void ): () => void;
	/** Leave presence and stop listening. The journey in storage is kept. */
	stop(): void;
}

interface WPSPresenceApi {
	/**
	 * Track this visitor on a channel the token may write presence to (0.30): presence as `{ v, n, j, ...state }`,
	 * the journey kept across pages, visits and leaves reported to the `wpsignal_visitor_visit` and `wpsignal_visitor_leave` actions.
	 */
	track( channel: string, options?: WPSTrackOptions ): WPSPresenceTracker;
}

/** Public API exposed by the WordSocket client on window.WPS */
interface WPSApi {
	/** Subscribe to additional channels on the shared connection. */
	subscribe( channels: string[] ): void;
	/** Unsubscribe from channels. */
	unsubscribe( channels: string[] ): void;
	/** Publish a JSON message through the WebSocket. No-ops on SSE (one-way transport). */
	publish( channel: string, event: string, data?: Record< string, unknown > ): void;
	/**
	 * Send a raw binary frame to the server over the WebSocket.
	 * Frame format: 2-byte BE channel name length + channel bytes + payload.
	 * No-ops on SSE (one-way transport) or when not connected.
	 */
	publishBinary( channel: string, data: Uint8Array ): void;
	/**
	 * Enter or update connection-scoped presence on a channel. The relay drops
	 * the membership the instant this socket closes, and the client re-sends it
	 * on reconnect; pass null to leave, which is announced at once. Subscribers
	 * of the channel receive `wps.presence` join/leave/sync events (`channel` is
	 * the site-relative name, `woo:carts:live`). Requires WebSocket; no-op on SSE.
	 */
	setPresence( channel: string, state: Record< string, unknown > | null ): void;
	/** Register a handler for a specific event name. Returns unsubscribe fn. */
	on( event: string, handler: WPSEventHandler ): () => void;
	/** Register a catch-all handler for incoming JSON messages. Returns unsubscribe fn. */
	onMessage( handler: WPSMessageHandler ): () => void;
	/** Register a handler for incoming binary frames. Returns unsubscribe fn. */
	onBinaryMessage( handler: WPSBinaryHandler ): () => void;
	/** Whether the connection is currently open. */
	readonly connected: boolean;
	/** Current transport layer, or null while still connecting. */
	readonly transport: WPSTransportName | null;
	/** Current transport state and capabilities. */
	readonly status: WPSStatus;
	/** Register a callback for connection state changes. Returns unsubscribe fn. */
	onConnectionChange( handler: ( connected: boolean ) => void ): () => void;
	/** Register a callback receiving the full connection state (error, retry countdown, failure count). Returns unsubscribe fn. */
	onStateChange( handler: ( state: WPSConnectionState ) => void ): () => void;
	/** The current connection state, as delivered to onStateChange. */
	readonly state: WPSConnectionState;
	/**
	 * A version-4 UUID. Works on plain HTTP pages too, where `crypto.randomUUID`
	 * does not exist (it needs a secure context); use it instead of calling
	 * `crypto.randomUUID()` directly. Needs no connection.
	 */
	uuid(): string;
	/**
	 * This browser's stable id, kept in localStorage and shared by every tab
	 * and every extension on the site, for counting people rather than sockets
	 * (pass it in presence state). It names a browser, not a person; when
	 * storage is blocked it lasts for the page load only.
	 */
	visitorId(): string;
	/**
	 * Whether an event's `channel` is the `expected` one, given by its
	 * site-relative name (`woo:stock`); the qualified `site:{id}:woo:stock`
	 * matches too. Any tokened browser may publish on a public channel, so
	 * check this in a handler before trusting the event's data.
	 */
	onChannel( channel: string, expected: string ): boolean;
	/** Visitor tracking over presence: `WPS.presence.track( channel, options )`. */
	readonly presence: WPSPresenceApi;
}

// ---------------------------------------------------------------------------
// Ambient module declarations for WordPress externals used by the Yjs provider.
// Runtime values are provided by WordPress core (wp.sync, wp.hooks).
// ---------------------------------------------------------------------------

declare module '@wordpress/sync' {
	/** Yjs library re-exported by @wordpress/sync. Import from here, not from 'yjs', to avoid duplicate instances. */
	export const Y: {
		/** v1 — kept for reference; WordPress uses v2 internally. */
		applyUpdate( doc: unknown, update: Uint8Array, origin?: unknown ): void;
		/** @param encodedTargetStateVector — if provided, encodes only the updates the target is missing. */
		encodeStateAsUpdate( doc: unknown, encodedTargetStateVector?: Uint8Array ): Uint8Array;
		encodeStateVector( doc: unknown ): Uint8Array;
		/** v2 — used by WordPress 7.0 sync observers. Always prefer these. */
		applyUpdateV2( doc: unknown, update: Uint8Array, origin?: unknown ): void;
		encodeStateAsUpdateV2( doc: unknown, encodedTargetStateVector?: Uint8Array ): Uint8Array;
		encodeStateVectorFromUpdateV2( update: Uint8Array ): Uint8Array;
	};
}

declare module '@wordpress/hooks' {
	export function addFilter(
		hookName: string,
		namespace: string,
		callback: ( ...args: unknown[] ) => unknown,
		priority?: number
	): void;
}
