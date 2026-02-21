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
 * The callback intentionally ignores the incoming providers array rather than
 * spreading it. WordPress 7.0 pre-populates the array with its default HTTP
 * polling provider (PR #74564). By returning a fresh array containing only
 * WPSignal's creator, we replace HTTP polling with the WebSocket transport —
 * matching the pattern used by the VIP reference implementation.
 */

import { addFilter } from '@wordpress/hooks';
import { wpsignalProviderCreator } from './yjs-provider';

addFilter(
	'sync.providers',
	'wpsignal/yjs-provider',
	() => [ wpsignalProviderCreator ],
);
