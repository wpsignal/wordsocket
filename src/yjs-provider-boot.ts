/**
 * WordSocket Yjs Provider Boot
 *
 * Registers the WordSocket Yjs sync provider with Gutenberg's real-time
 * collaboration via the `sync.providers` filter. Enqueued only in the block
 * editor when collaboration is available and enabled (class-wpsignal-client.php).
 *
 * Gutenberg (23.8+) applies the filter only when
 * `window.__experimentalEnableRealTimeCollaboration` is true; it is false in
 * the site editor even with the experiment on, so registering there would be
 * a silent no-op. Older builds do not define the flag at all.
 *
 * The callback replaces the incoming providers array with only WordSocket's
 * creator, which removes the default HTTP polling provider. If WebSocket is
 * unavailable the callback passes the array through unchanged, preserving
 * HTTP polling as the active transport.
 */

import { addFilter } from "@wordpress/hooks";
import { wpsignalProviderCreator, SSE_FALLBACK_ERROR_CODE } from "./yjs-provider";
import { wpsDebug } from "./utils";

const rtcFlag = (window as { __experimentalEnableRealTimeCollaboration?: boolean })
  .__experimentalEnableRealTimeCollaboration;

if (rtcFlag === false) {
  wpsDebug(
    "Real-time collaboration is off on this screen",
    "Gutenberg disables it here (for example in the site editor); the WordSocket provider is not registered.",
    "log",
    false,
    "[WordSocket Yjs]",
  );
} else {
  addFilter("sync.providers", "wpsignal/yjs-provider", (providers) => {
    wpsDebug("sync.providers", providers);
    if (typeof WebSocket === "undefined") {
      wpsDebug(
        "WebSocket is not available",
        "in this browser. The Yjs provider has not been registered; real-time collaboration will use HTTP polling instead.",
        "error",
        false,
        "[WordSocket Yjs]",
      );
      return providers;
    }
    return [wpsignalProviderCreator];
  });

  // When the client fell back to SSE the no-op provider reports a permanent
  // error; tell the editor it is handled so core's generic "connection lost"
  // dialog stays closed (the toolbar still shows the disconnected state).
  addFilter(
    "editor.isSyncConnectionErrorHandled",
    "wpsignal/yjs-provider",
    (handled: unknown, code: unknown) =>
      handled === true ||
      (code === SSE_FALLBACK_ERROR_CODE && window.WPS?.transport === "sse"),
  );
}
