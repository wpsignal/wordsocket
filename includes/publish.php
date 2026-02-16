<?php
/**
 * WPSignal publish helper — backward-compatibility wrapper.
 *
 * This file provides the legacy `wpsignal_publish()` function for any code
 * that calls it directly. It delegates to the OOP publisher via the facade.
 *
 * @package WPSignal
 * @see WPSignal::publish()
 * @see WPSignal_Publisher::publish()
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Publish an event to wpsignal.io.
 *
 * Backward-compatible wrapper around WPSignal::publish(). Prefer using
 * the static facade directly in new code:
 *
 *     WPSignal::publish( 'events', 'custom.event', [ 'key' => 'value' ] );
 *
 * @param string $channel Channel name (e.g. "events"). Scoped server-side.
 * @param string $event   Event name (e.g. "post.updated").
 * @param mixed  $data    Arbitrary data (will be JSON-encoded).
 * @return array|WP_Error wp_remote_post response array on success, WP_Error on failure.
 */
function wpsignal_publish( $channel, $event, $data = array() ) {
	return WPSignal::publish( $channel, $event, $data );
}
