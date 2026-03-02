import { wpsDebug } from "../utils";

declare global {
  interface Window {
    wpSignalConfig?: WpSignalConfig;
    wpsignalSettings?: WpSignalSettings;
    wpSignalKitchenSink?: WpSignalKitchenSink;
    wpSignalMonitor?: WpSignalMonitor;
    wpSignalYjsConfig?: WpSignalYjsConfig;
    WPS?: WPSApi;
    wpsDebug?: (
      label: string,
      summary?: any,
      type?: "log" | "error" | "warn" | "info",
      collapse?: boolean,
      prefix?: string,
    ) => void;
  }
}

export {};
