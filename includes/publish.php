<?php
/**
 * WPSignal\Publish - backward-compatibility wrapper.
 *
 * This file provides the legacy `wpsignal_publish()` function for any code
 * that calls it directly. It delegates to the OOP publisher via the facade.
 *
 * @package WPSignal
 * @see WPS::publish()
 * @see Publisher::publish()
 */

 namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Publish an event to wpsignal.io.
 *
 * Backward-compatible wrapper around WPS::publish(). Prefer using
 * the static facade directly in new code:
 *
 *     WPS::publish( 'events', 'custom.event', [ 'key' => 'value' ] );
 *
 * @param string $channel Channel name (e.g. "events"). Scoped server-side.
 * @param string $event   Event name (e.g. "post.updated").
 * @param mixed  $data    Arbitrary data (will be JSON-encoded).
 * @return array|WP_Error wp_remote_post response array on success, WP_Error on failure.
 */
function wpsignal_publish( $channel, $event, $data = array() ) {
	return WPS::publish( $channel, $event, $data );
}
