<?php
/**
 * WPSignal\Token - JWT minting and REST API endpoints.
 *
 * Registers three REST API endpoints under the `wpsignal/v1` namespace:
 *
 *   POST /wp-json/wpsignal/v1/token  : Mint a short-lived connection JWT (any logged-in user).
 *   POST /wp-json/wpsignal/v1/connect : Register this site with the WPSignal server (admin only).
 *   POST /wp-json/wpsignal/v1/publish : Publish an event via PHP proxy (admin only).
 *   GET  /wp-json/wpsignal/v1/settings: Read connection settings (admin only).
 *   POST /wp-json/wpsignal/v1/settings: Save connection settings (admin only).
 *
 * The token endpoint mints HS256 JWTs that browsers use to connect via
 * WebSocket or SSE. The JWT contains tenant_id, site_id, user_id, and
 * allowed_channel_prefixes: the server enforces these claims.
 *
 * The publish endpoint acts as a server-side proxy so the HMAC site secret
 * never reaches the browser. Used by the Kitchen Sink demo page.
 *
 * @package WPSignal
 */

 namespace WPSignal;

 use WP_REST_Request, WP_Error, WP_REST_Response;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Token {

	/** @var Config Configuration accessor. */
	private $config;

	/** @var Publisher Event publisher (used by the /publish proxy). */
	private $publisher;

	/**
	 * @param Config    $config    Configuration accessor.
	 * @param Publisher $publisher Event publisher for the /publish proxy.
	 */
	public function __construct( Config $config, Publisher $publisher ) {
		$this->config    = $config;
		$this->publisher = $publisher;
	}

	/**
	 * Register all WPSignal REST routes.
	 *
	 * Hooked to `rest_api_init` during WPSignal::boot().
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route( 'wpsignal/v1', '/token', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'handle_token' ),
			'permission_callback' => function () {
				$nonce = isset( $_SERVER['HTTP_X_WP_NONCE'] )
					? sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_WP_NONCE'] ) )
					: ( isset( $_REQUEST['_wpnonce'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['_wpnonce'] ) ) : '' );

				if ( empty( $nonce ) || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
					return new WP_Error(
						'rest_nonce_invalid',
						__( 'Nonce verification failed.', 'signal' ),
						array( 'status' => 403 )
					);
				}

				return true;
			},
		) );

		register_rest_route( 'wpsignal/v1', '/connect', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'handle_connect' ),
			'permission_callback' => function () {
				return current_user_can( 'manage_options' );
			},
		) );

		register_rest_route( 'wpsignal/v1', '/publish', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'handle_publish' ),
			'permission_callback' => function () {
				return current_user_can( 'manage_options' );
			},
		) );

		register_rest_route( 'wpsignal/v1', '/settings', array(
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'handle_get_settings' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			),
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'handle_save_settings' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			),
		) );
	}

	/**
	 * Mint a short-lived connection JWT for the current user.
	 *
	 * Can be called directly from PHP (e.g. to embed the token in a page) or
	 * via the REST endpoint. Returns a plain array on success or WP_Error on
	 * failure.
	 *
	 * Return value:
	 *
	 *     [
	 *         'token'    => 'eyJ...',
	 *         'channels' => ['site:{site_id}:events'],
	 *         'exp'      => 1700000000,
	 *     ]
	 *
	 * @return array|\WP_Error Token data array or error.
	 */
	public function mint() {
		$jwt_secret = $this->config->jwt_secret();
		if ( empty( $jwt_secret ) ) {
			return new WP_Error(
				'wpsignal_no_jwt_secret',
				__( 'JWT secret not configured.', 'signal' ),
				array( 'status' => 500 )
			);
		}

		$site_key = $this->config->site_key();
		if ( empty( $site_key ) ) {
			return new WP_Error(
				'wpsignal_not_configured',
				__( 'WPSignal is not configured.', 'signal' ),
				array( 'status' => 500 )
			);
		}

		$user      = wp_get_current_user();
		$now       = time();
		$exp       = $now + 300;
		$tenant_id = hash( 'sha256', 'tenant:' . $site_key );
		$site_id   = hash( 'sha256', 'site:' . $site_key );

		$header = self::base64url_encode( wp_json_encode( array(
			'alg' => 'HS256',
			'typ' => 'JWT',
		) ) );

		$payload = self::base64url_encode( wp_json_encode( array(
			'tenant_id'                => $tenant_id,
			'site_id'                  => $site_id,
			'user_id'                  => (string) $user->ID,
			'allowed_channel_prefixes' => array( 'site:' . $site_id . ':' ),
			'iat'                      => $now,
			'exp'                      => $exp,
		) ) );

		$signature = self::base64url_encode(
			hash_hmac( 'sha256', $header . '.' . $payload, $jwt_secret, true )
		);

		return array(
			'token'    => $header . '.' . $payload . '.' . $signature,
			'channels' => array( 'site:' . $site_id . ':events' ),
			'exp'      => $exp,
		);
	}

	/**
	 * REST handler: mint a token for the current user and return it as JSON.
	 *
	 * @param WP_REST_Request $request The incoming REST request.
	 * @return \WP_REST_Response|\WP_Error Token response or error.
	 */
	public function handle_token( WP_REST_Request $request ) {
		$result = $this->mint();
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	/**
	 * Admin-only publish proxy.
	 *
	 * Routes a publish request through PHP so the HMAC site secret never
	 * reaches the browser. Used by the Kitchen Sink demo page.
	 *
	 * Request body:
	 *
	 *     { "channel": "events", "event": "test.event", "data": { ... } }
	 *
	 * Response:
	 *
	 *     { "ok": true }
	 *
	 * @param WP_REST_Request $request The incoming REST request.
	 * @return WP_REST_Response|\WP_Error Success response or error.
	 */
	public function handle_publish( WP_REST_Request $request ) {
		$channel = $request->get_param( 'channel' );
		$event   = $request->get_param( 'event' );
		$data    = $request->get_param( 'data' );

		if ( empty( $channel ) || empty( $event ) ) {
			return new WP_Error(
				'wpsignal_missing_params',
				__( 'Channel and event are required.', 'signal' ),
				array( 'status' => 400 )
			);
		}

		$result = $this->publisher->publish( $channel, $event, $data ? $data : array() );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response( array( 'ok' => true ) );
	}

	/**
	 * Register this WordPress site with the WPSignal server.
	 *
	 * POSTs to {base_url}/api/sites/register with the user's API key.
	 * On success, saves the returned site_key, publish_secret, and jwt_secret
	 * to wp_options via Config::save_registration().
	 *
	 * Called by the "Connect to WPSignal" button on the settings page.
	 *
	 * Response on success:
	 *
	 *     { "message": "Connected to WPSignal!", "site_key": "abc123..." }
	 *
	 * @param WP_REST_Request $request The incoming REST request.
	 * @return WP_REST_Response|\WP_Error Success response or error.
	 */
	public function handle_connect( WP_REST_Request $request ) {
		$base_url = $this->config->base_url();
		$api_key  = $this->config->api_key();

		if ( empty( $base_url ) || empty( $api_key ) ) {
			return new WP_Error(
				'wpsignal_not_configured',
				__( 'Please save your Server URL and API Key first.', 'signal' ),
				array( 'status' => 400 )
			);
		}

		$response = wp_remote_post( trailingslashit( $base_url ) . 'api/sites/register', array(
			'timeout' => 10,
			'headers' => array(
				'Content-Type'  => 'application/json',
				'Authorization' => 'Bearer ' . $api_key,
			),
			'body' => wp_json_encode( array(
				'site_url'  => home_url(),
				'site_name' => get_bloginfo( 'name' ),
			) ),
		) );

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'wpsignal_connect_failed',
				$response->get_error_message(),
				array( 'status' => 502 )
			);
		}

		$code = wp_remote_retrieve_response_code( $response );
		if ( $code !== 200 ) {
			$body = wp_remote_retrieve_body( $response );
			return new WP_Error(
				'wpsignal_connect_failed',
				sprintf( 'HTTP %d: %s', $code, $body ),
				array( 'status' => 502 )
			);
		}

		$data = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( empty( $data['site_key'] ) || empty( $data['publish_secret'] ) || empty( $data['jwt_secret'] ) ) {
			return new WP_Error(
				'wpsignal_invalid_response',
				__( 'Invalid response from server.', 'signal' ),
				array( 'status' => 502 )
			);
		}

		$this->config->save_registration( $data );

		return rest_ensure_response( array(
			'message'  => __( 'Connected to WPSignal!', 'signal' ),
			'site_key' => $data['site_key'],
		) );
	}

	/**
	 * Return current connection settings.
	 *
	 * When the site appears locally configured, verifies the site_key still
	 * exists on the server via a lightweight publish. If the server returns
	 * 401 (unknown site key), the local registration is cleared.
	 *
	 * Response:
	 *
	 *     { "base_url": "…", "api_key": "…", "site_key": "…", "is_connected": true }
	 *
	 * @param WP_REST_Request $request The incoming REST request.
	 * @return WP_REST_Response Settings response.
	 */
	public function handle_get_settings( WP_REST_Request $request ) {
		$is_connected = $this->config->is_configured();

		if ( $is_connected ) {
			$is_connected = $this->verify_site_exists();
		}

		return rest_ensure_response( array(
			'base_url'     => $this->config->base_url(),
			'api_key'      => $this->config->api_key(),
			'site_key'     => $is_connected ? $this->config->site_key() : '',
			'is_connected' => $is_connected,
		) );
	}

	/**
	 * Verify the registered site still exists on the WPSignal server.
	 *
	 * Sends a publish request with a dummy signature so the server never
	 * reaches hub.publish(): no event is broadcast. The server checks
	 * site_key existence before HMAC verification, so the response body
	 * distinguishes the two 401 cases:
	 *
	 *   - "unknown site key"  → site was deleted → clear local credentials.
	 *   - "invalid signature" → site still exists (expected, since we sent a dummy).
	 *
	 * Network errors are treated as "still connected" to avoid false
	 * negatives when the server is temporarily unreachable.
	 *
	 * @return bool True if the site still exists (or server is unreachable).
	 */
	private function verify_site_exists() {
		$body         = '{}';
		$timestamp_ms = (string) round( microtime( true ) * 1000 );
		$url          = trailingslashit( $this->config->base_url() ) . 'publish';

		$response = wp_remote_post( $url, array(
			'timeout' => 3,
			'headers' => array(
				'Content-Type'     => 'application/json',
				'X-WP-Signal-Key'  => $this->config->site_key(),
				'X-WP-Signal-Ts'   => $timestamp_ms,
				'X-WP-Signal-Sign' => 'dummy',
			),
			'body' => $body,
		) );

		if ( is_wp_error( $response ) ) {
			return true; // Network error: assume still connected.
		}

		$response_body = wp_remote_retrieve_body( $response );

		if ( strpos( $response_body, 'unknown site key' ) !== false ) {
			delete_option( 'wpsignal_site_key' );
			delete_option( 'wpsignal_site_secret' );
			delete_option( 'wpsignal_jwt_secret' );
			return false;
		}

		return true;
	}

	/**
	 * Save connection settings (Server URL and API Key).
	 *
	 * Request body:
	 *
	 *     { "base_url": "https://…", "api_key": "abc123" }
	 *
	 * @param WP_REST_Request $request The incoming REST request.
	 * @return WP_REST_Response Updated settings response.
	 */
	public function handle_save_settings( WP_REST_Request $request ) {
		$base_url = $request->get_param( 'base_url' );
		$api_key  = $request->get_param( 'api_key' );

		if ( $base_url !== null ) {
			update_option( 'wpsignal_base_url', esc_url_raw( $base_url ) );
		}
		if ( $api_key !== null ) {
			update_option( 'wpsignal_api_key', sanitize_text_field( $api_key ) );
		}

		return rest_ensure_response( array(
			'base_url'     => $this->config->base_url(),
			'api_key'      => $this->config->api_key(),
			'site_key'     => $this->config->site_key(),
			'is_connected' => $this->config->is_configured(),
		) );
	}

	/**
	 * Base64url encoding per RFC 7515.
	 *
	 * Replaces +/ with -_ and strips trailing = padding. Used for JWT
	 * header, payload, and signature segments.
	 *
	 * @param string $data Raw binary or string data to encode.
	 * @return string Base64url-encoded string.
	 */
	public static function base64url_encode( $data ) {
		return rtrim( strtr( base64_encode( $data ), '+/', '-_' ), '=' );
	}
}
