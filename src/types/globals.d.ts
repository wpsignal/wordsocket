/** Localized by class-wpsignal-client.php */
interface WpSignalConfig {
	debug: boolean;
	restUrl: string;
	nonce: string;
	baseUrl: string;
	/** Server-side minted token (present on first load; absent on refresh calls). */
	token?: string;
	channels?: string[];
	exp?: number;
	/** Base64-encoded raw AES-256 key for decrypting incoming "encrypted" messages. Never sent to WPSignal. */
	encryptionKey?: string;
	/** Force use of SSE instead of WebSocket. */
	forceSSE?: boolean;
}

/** Localized by class-wpsignal-admin-page.php (Settings React app) */
interface WpSignalSettings {
	connectUrl: string;
	restUrl: string;
	nonce: string;
	postTypes: Array< { value: string; label: string } >;
	baseUrl: string;
	apiKey: string;
	siteKey: string;
}

/** Localized by class-wpsignal-client.php (enqueue_yjs_provider) */
interface WpSignalYjsConfig {
	/** Channel prefix for Yjs channels, e.g. `site:{site_id}:yjs:`. Keeps Yjs channels within the JWT's allowed_channel_prefixes. */
	channelPrefix: string;
}

/** Localized by class-wpsignal-explorer-page.php */
interface WpSignalExplorer {
	baseUrl: string;
	siteKey: string;
	restUrl: string;
	tokenUrl: string;
	publishUrl: string;
	nonce: string;
	configured: boolean;
}

type WPSMessageHandler = ( event: string, data: Record< string, unknown >, channel: string ) => void;
type WPSEventHandler = ( data: Record< string, unknown >, channel: string ) => void;
/** Handler for incoming binary WebSocket frames (e.g. Yjs updates). */
type WPSBinaryHandler = ( channel: string, data: Uint8Array ) => void;

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
	/** Register a handler for a specific event name. Returns unsubscribe fn. */
	on( event: string, handler: WPSEventHandler ): () => void;
	/** Register a catch-all handler for incoming JSON messages. Returns unsubscribe fn. */
	onMessage( handler: WPSMessageHandler ): () => void;
	/** Register a handler for incoming binary frames. Returns unsubscribe fn. */
	onBinaryMessage( handler: WPSBinaryHandler ): () => void;
	/** Whether the connection is currently open. */
	readonly connected: boolean;
	/** Current transport layer, or null while still connecting. */
	readonly transport: 'ws' | 'sse' | null;
	/** Register a callback for connection state changes. Returns unsubscribe fn. */
	onConnectionChange( handler: ( connected: boolean ) => void ): () => void;
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
