declare global {
	interface Window {
		wpSignalConfig?: WpSignalConfig;
		wpsignalSettings?: WpSignalSettings;
		wpSignalKitchenSink?: WpSignalKitchenSink;
		wpSignalMonitor?: WpSignalMonitor;
		WPS?: WPSApi;
	}
}

export {};