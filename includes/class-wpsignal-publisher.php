<?php
/**
 * WPSignal\Publisher: HMAC-signed event publishing.
 *
 * Sends events to the WPSignal server via HTTP POST with HMAC-SHA256
 * authentication. The signature scheme matches the server's verification:
 *
 * signature = HMAC-SHA256( json_body + "." + timestamp_ms, site_secret )
 *
 * Headers sent:
 * - X-WP-Signal-Key : site key (public identifier)
 * - X-WP-Signal-Ts  : millisecond timestamp
 * - X-WP-Signal-Sign: hex-encoded HMAC signature
 *
 * @package WordSocket
 */

namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * HMAC-signed event publishing.
 */
class Publisher {

	/**
	 * Configuration accessor.
	 *
	 * @var Config
	 */
	private $config;

	/**
	 * Constructor.
	 *
	 * @param Config $config Configuration accessor.
	 * @return void
	 */
	public function __construct( Config $config ) {
		$this->config = $config;
	}

	/**
	 * Check whether the site is currently throttled by a server-side quota limit.
	 *
	 * Not enforced: the option can be cleared to retry immediately.
	 * It is a performance measure, not a hard gate.
	 *
	 * @return bool True if the site is currently throttled (messages_until is in the future).
	 */
	private function is_message_quota_exceeded() {
		$limits = get_option( 'wpsignal_limits', array() );
		if ( empty( $limits['messages_until'] ) ) {
			return false;
		}
		return time() < (int) $limits['messages_until'];
	}

	/**
	 * Persist a throttle timestamp received from the server's 429 response.
	 *
	 * @param string $error_code Server error code (e.g. "quota_exceeded").
	 */
	private function store_limit( $error_code ) {
		if ( 'quota_exceeded' !== $error_code ) {
			return;
		}
		// Throttle until the end of the current calendar month (UTC).
		$end_of_month             = mktime( 23, 59, 59, (int) gmdate( 'n' ) + 1, 0, (int) gmdate( 'Y' ) );
		$limits                   = get_option( 'wpsignal_limits', array() );
		$limits['messages_until'] = $end_of_month;
		update_option( 'wpsignal_limits', $limits, false );
	}

	/**
	 * Publish an event to the WPSignal server.
	 *
	 * @usage: publish an event:
	 * ```php
	 *     $publisher = WPS::instance()->publisher();
	 *     $publisher->publish( 'events', 'post.updated', [
	 *         'post_id'    => 42,
	 *         'post_title' => 'Hello World',
	 *     ] );
	 * ```
	 * @param string $channel Channel name (e.g. "events"). Scoped server-side.
	 * @param string $event   Event name (e.g. "post.updated").
	 * @param mixed  $data    Arbitrary data (will be JSON-encoded).
	 * @return array|WP_Error wp_remote_post response array on success, WP_Error on failure.
	 */
	public function publish( $channel, $event, $data = array() ) {
		if ( ! $this->config->is_configured() ) {
			return new \WP_Error( 'wpsignal_not_configured', __( 'WordSocket is not configured.', 'wordsocket' ), array( 'status' => 500 ) );
		}

		if ( $this->is_message_quota_exceeded() ) {
			return new \WP_Error( 'wpsignal_quota_exceeded', __( 'Monthly message quota reached.', 'wordsocket' ), array( 'status' => 429 ) );
		}

		/**
		 * Encrypt the event name and data so the relay only ever sees ciphertext.
		 * Skip encryption on HTTP: SubtleCrypto is not available in non-secure browsers.
		 */
		$plaintext = wp_json_encode(
			array(
				'event' => $event,
				'data'  => $data,
			)
		);
		$encrypted = is_ssl() ? $this->encrypt( $plaintext ) : false;

		if ( false !== $encrypted ) {
			$body = wp_json_encode(
				array(
					'channel' => $channel,
					'event'   => 'encrypted',
					'data'    => array(
						'v' => 1,
						'p' => $encrypted,
					),
				)
			);
		} else {
			$body = wp_json_encode(
				array(
					'channel' => $channel,
					'event'   => $event,
					'data'    => $data,
				)
			);
		}

		$timestamp_ms = (string) round( microtime( true ) * 1000 );
		$signature    = $this->sign( $body, $timestamp_ms );

		$url = trailingslashit( $this->config->base_url() ) . 'publish';

		$is_dev = defined( 'WP_ENVIRONMENT_TYPE' ) && in_array( WP_ENVIRONMENT_TYPE, array( 'development', 'local', 'staging' ), true );

		$response = wp_remote_post(
			$url,
			array(
				'timeout' => 2,
				'headers' => array(
					'Content-Type'     => 'application/json',
					'X-WP-Signal-Key'  => $this->config->site_key(),
					'X-WP-Signal-Ts'   => $timestamp_ms,
					'X-WP-Signal-Sign' => $signature,
				),
				'body'    => $body,
			)
		);

		if ( is_wp_error( $response ) ) {
			if ( $is_dev ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[WPSignal] Publish failed: ' . $response->get_error_message() );
			}
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		if ( $code < 200 || $code >= 300 ) {
			$body_text  = wp_remote_retrieve_body( $response );
			$error_data = json_decode( $body_text, true );
			$message    = is_array( $error_data ) && isset( $error_data['message'] )
				? $error_data['message']
				: sprintf( 'HTTP %d', $code );
			if ( $is_dev ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( sprintf( '[WPSignal] Publish HTTP %d: %s', $code, $message ) );
			}
			// On quota 429, store the throttle timestamp to skip future requests for the current month.
			// Throttle is best-effort; billing period boundaries may differ between client and server.
			if ( 429 === $code && is_array( $error_data ) && isset( $error_data['error'] ) ) {
				$this->store_limit( $error_data['error'] );
			}
			return new \WP_Error( 'wpsignal_publish_error', $message );
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

	/**
	 * Encrypt a plaintext string using AES-256-GCM.
	 *
	 * @param string $plaintext Data to encrypt.
	 * @return string|false Base64-encoded payload, or false if key is unavailable
	 *                      or OpenSSL encryption fails.
	 */
	private function encrypt( $plaintext ) {
		$key = $this->config->encryption_key();
		if ( empty( $key ) ) {
			return false;
		}

		$iv     = random_bytes( 12 );
		$tag    = '';
		$cipher = openssl_encrypt( $plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag );

		if ( false === $cipher ) {
			return false;
		}

		return base64_encode( $iv . $cipher . $tag );
	}
}
