<?php
/**
 * WPSignal\Publisher — HMAC-signed event publishing.
 *
 * Sends events to the WPSignal server via HTTP POST with HMAC-SHA256
 * authentication. The signature scheme matches the server's verification:
 *
 *   signature = HMAC-SHA256( json_body + "." + timestamp_ms, site_secret )
 *
 * Headers sent:
 *   - X-WP-Signal-Key  — site key (public identifier)
 *   - X-WP-Signal-Ts   — millisecond timestamp
 *   - X-WP-Signal-Sign — hex-encoded HMAC signature
 *
 * Usage via the static facade:
 *
 *     WPS::publish( 'events', 'post.updated', [ 'post_id' => 42 ] );
 *
 * Usage via the instance:
 *
 *     $publisher = WPS::instance()->publisher();
 *     $result    = $publisher->publish( 'events', 'custom.event', $data );
 *
 *     if ( is_wp_error( $result ) ) {
 *         // Handle error.
 *     }
 *
 * @package WPSignal
 */

 namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Publisher {

	/** @var Config */
	private $config;

	/**
	 * @param Config $config Configuration accessor.
	 */
	public function __construct( Config $config ) {
		$this->config = $config;
	}

	/**
	 * Publish an event to the WPSignal server.
	 *
	 * Builds a JSON payload, signs it with the site secret, and POSTs it
	 * to {base_url}/publish. The server normalizes the channel name and
	 * fans out the event to all subscribed connections.
	 *
	 * Example:
	 *
	 *     $publisher->publish( 'events', 'post.updated', [
	 *         'post_id'    => 42,
	 *         'post_title' => 'Hello World',
	 *     ] );
	 *
	 * @param string $channel Channel name (e.g. "events"). Scoped server-side.
	 * @param string $event   Event name (e.g. "post.updated").
	 * @param mixed  $data    Arbitrary data (will be JSON-encoded).
	 * @return array|WP_Error wp_remote_post response array on success, WP_Error on failure.
	 */
	public function publish( $channel, $event, $data = array() ) {
		if ( ! $this->config->is_configured() ) {
			return new \WP_Error( 'wpsignal_not_configured', __( 'WPSignal is not configured.', 'signal-realtime' ) );
		}

		$body = wp_json_encode( array(
			'channel' => $channel,
			'event'   => $event,
			'data'    => $data,
		) );

		$timestamp_ms = (string) round( microtime( true ) * 1000 );
		$signature    = $this->sign( $body, $timestamp_ms );

		$url = trailingslashit( $this->config->base_url() ) . 'publish';

		$is_dev = defined( 'WP_ENVIRONMENT_TYPE' ) && WP_ENVIRONMENT_TYPE === 'development';

		$response = wp_remote_post( $url, array(
			'timeout' => 2,
			'headers' => array(
				'Content-Type'     => 'application/json',
				'X-WP-Signal-Key'  => $this->config->site_key(),
				'X-WP-Signal-Ts'   => $timestamp_ms,
				'X-WP-Signal-Sign' => $signature,
			),
			'body' => $body,
		) );

		if ( is_wp_error( $response ) ) {
			if ( $is_dev ) {
				error_log( '[WPSignal] Publish failed: ' . $response->get_error_message() );
			}
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		if ( $code < 200 || $code >= 300 ) {
			$body_text = wp_remote_retrieve_body( $response );
			if ( $is_dev ) {
				error_log( sprintf( '[WPSignal] Publish HTTP %d: %s', $code, $body_text ) );
			}
			return new \WP_Error( 'wpsignal_publish_error', sprintf( 'HTTP %d: %s', $code, $body_text ) );
		}

		return $response;
	}

	/**
	 * Generate an HMAC-SHA256 signature for a publish request.
	 *
	 * @param string $body         Raw JSON body string.
	 * @param string $timestamp_ms Millisecond timestamp string.
	 * @return string Hex-encoded HMAC-SHA256 signature.
	 */
	private function sign( $body, $timestamp_ms ) {
		return hash_hmac( 'sha256', $body . '.' . $timestamp_ms, $this->config->site_secret() );
	}
}
