/*
 * The client's config, read from the JSON block PHP prints.
 */

const CONFIG_BLOCK_ID = "wpsignal-config";

/**
 * The config from the page's JSON block, or undefined when the page prints none or it does not parse.
 *
 * @since 0.31.0
 */
export function readPrintedConfig(): WpSignalConfig | undefined {
  const text = document.getElementById(CONFIG_BLOCK_ID)?.textContent;
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object"
      ? (parsed as WpSignalConfig)
      : undefined;
  } catch {
    return undefined;
  }
}
