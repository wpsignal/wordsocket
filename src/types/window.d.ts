import { wpsDebug } from "../utils";

declare global {
  interface Window {
    wpSignalConfig?: WpSignalConfig;
    wpsignalSettings?: WpSignalSettings;
    wpSignalYjsConfig?: WpSignalYjsConfig;
    WPS?: WPSApi;
    /** Extension API published by the settings bundle (admin.php?page=wordsocket only). */
    wordsocket?: WordSocketExtensionsApi;
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
