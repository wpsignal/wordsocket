/**
 * WPSignal Yjs Provider Boot
 *
 * Registers the WPSignal Yjs sync provider with WordPress 7.0+ via the
 * `sync.providers` filter (PR #72183). Enqueued only in the block editor
 * context when WP 7.0+ is detected (see class-wpsignal-client.php).
 *
 * WordPress core calls:
 *   applyFilters( 'sync.providers', [] )
 * and expects an array of async provider creator functions.
 *
 * The callback replaces the incoming providers array with only WPSignal's
 * creator, which removes the default HTTP polling provider. If WebSocket is
 * unavailable the callback passes the array through unchanged, preserving
 * HTTP polling as the active transport.
 */

import { addFilter } from "@wordpress/hooks";
import { wpsignalProviderCreator } from "./yjs-provider";
import { wpsDebug } from "./utils";

addFilter("sync.providers", "wpsignal/yjs-provider", (providers) => {
  wpsDebug("sync.providers", providers);
  if (typeof WebSocket === "undefined") {
    wpsDebug(
      "WebSocket is not available",
      "in this browser. The Yjs provider has not been registered — real-time collaboration will use HTTP polling instead.",
      "error",
      false,
      "[WPSignal Yjs]",
    );
    return providers;
  }
  return [wpsignalProviderCreator];
});
