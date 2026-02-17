/** Localized by class-wpsignal-client.php */
interface WpSignalConfig {
	restUrl: string;
	nonce: string;
	baseUrl: string;
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

/** Localized by class-wpsignal-kitchen-sink-page.php */
interface WpSignalKitchenSink {
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

/** Public API exposed by the WPSignal client on window.WPS */
interface WPSApi {
	/** Subscribe to additional channels on the shared connection. */
	subscribe( channels: string[] ): void;
	/** Unsubscribe from channels. */
	unsubscribe( channels: string[] ): void;
	/** Publish a message through the WebSocket. No-ops on SSE (one-way transport). */
	publish( channel: string, event: string, data?: Record< string, unknown > ): void;
	/** Register a handler for a specific event name. Returns unsubscribe fn. */
	on( event: string, handler: WPSEventHandler ): () => void;
	/** Register a catch-all handler for incoming messages. Returns unsubscribe fn. */
	onMessage( handler: WPSMessageHandler ): () => void;
	/** Whether the connection is currently open. */
	readonly connected: boolean;
	/** Register a callback for connection state changes. Returns unsubscribe fn. */
	onConnectionChange( handler: ( connected: boolean ) => void ): () => void;
}

declare global {
	interface Window {
		wpSignalConfig?: WpSignalConfig;
		wpsignalSettings?: WpSignalSettings;
		wpSignalKitchenSink?: WpSignalKitchenSink;
		WPS?: WPSApi;
	}
}

export {};
