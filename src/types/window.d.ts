import { wpsDebug } from "../utils";

declare global {
  interface Window {
    wpSignalConfig?: WpSignalConfig;
    wpsignalSettings?: WpSignalSettings;
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
