declare global {
	interface Window {
		wpSignalConfig?: WpSignalConfig;
		wpsignalSettings?: WpSignalSettings;
		wpSignalKitchenSink?: WpSignalKitchenSink;
		wpSignalMonitor?: WpSignalMonitor;
		wpSignalYjsConfig?: WpSignalYjsConfig;
		WPS?: WPSApi;
	}
}

export {};