/**
 * WPSignal utility functions.
 */

/**
 * Console styles for the different message types.
 */
const CONSOLE_STYLES = {
  log: "color: black; background-color: white;",
  error: "color: white; background-color: red;",
  warn: "color: yellow; background-color: black;",
};

/**
 * A utility function to debug the WPSignal JS API.
 *
 * @param label - The label to display in the console.
 * @param summary - The summary to display in the console. Can be a string or an object.
 * @param type - The type of message to display in the console.
 * @param collapse - Whether to collapse the console group.
 */
export function wpsDebug(
  label: string,
  summary: any = null,
  type: "log" | "error" | "warn" | "info" = "log",
  collapse: boolean = true,
  prefix: string = "",
) {
  const _type = type === "info" ? "log" : type;
  if (!window.wpSignalConfig?.debug && type === "log") {
    return;
  }
  const styledLabel = [
    `%c[WPSignal${prefix ? ` ${prefix}` : ""}] ${label}`,
    CONSOLE_STYLES[_type],
  ];
  if (summary === null) {
    console.log(...styledLabel);
    return;
  }
  console[collapse ? "groupCollapsed" : "group"](...styledLabel);
  console.log(summary);
  console.log(getStackTrace());
  console.groupEnd();
}

/**
 * Get the stack trace for the current function.
 *
 * @returns The stack trace as a string.
 */
function getStackTrace() {
  const obj: any = {};
  Error.captureStackTrace(obj, getStackTrace);
  const stack = obj.stack;
  // remove the first 2 lines from the trace string (this function and the caller)
  const trace = "Stack trace:\n" + stack.split("\n").slice(2).join("\n") + "\n";
  return trace;
}
