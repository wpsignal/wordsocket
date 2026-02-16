<?php
/**
 * WPSignal_Token — JWT minting and REST route registration.
 *
 * Registers three REST API endpoints under the `wpsignal/v1` namespace:
 *
 *   POST /wp-json/wpsignal/v1/token   — Mint a short-lived connection JWT (any logged-in user).
 *   POST /wp-json/wpsignal/v1/connect — Register this site with the WPSignal server (admin only).
 *   POST /wp-json/wpsignal/v1/publish — Publish an event via PHP proxy (admin only).
 *
 * The token endpoint mints HS256 JWTs that browsers use to connect via
 * WebSocket or SSE. The JWT contains tenant_id, site_id, user_id, and
 * allowed_channel_prefixes — the server enforces these claims.
 *
 * The publish endpoint acts as a server-side proxy so the HMAC site secret
 * never reaches the browser. Used by the Kitchen Sink demo page.
 *
 * @package WPSignal
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class WPSignal_Token {

	/** @var WPSignal_Config Configuration accessor. */
	private $config;

	/** @var WPSignal_Publisher Event publisher (used by the /publish proxy). */
	private $publisher;

	/**
	 * @param WPSignal_Config    $config    Configuration accessor.
	 * @param WPSignal_Publisher $publisher Event publisher for the /publish proxy.
	 */
	public function __construct( WPSignal_Config $config, WPSignal_Publisher $publisher ) {
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
				return is_user_logged_in();
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
	}

	/**
	 * Mint a short-lived connection JWT for the current user.
	 *
	 * The JWT is signed with the shared JWT_SECRET so the Rust server can
	 * verify it. Claims include tenant_id, site_id, user_id, and
	 * allowed_channel_prefixes. Default TTL is 5 minutes.
	 *
	 * Response:
	 *
	 *     {
	 *         "token":    "eyJ...",
	 *         "channels": ["site:{site_id}:events"],
	 *         "exp":      1700000000
	 *     }
	 *
	 * @param WP_REST_Request $request The incoming REST request.
	 * @return WP_REST_Response|WP_Error Token response or error.
	 */
	public function handle_token( WP_REST_Request $request ) {
		$jwt_secret = $this->config->jwt_secret();
		if ( empty( $jwt_secret ) ) {
			return new WP_Error(
				'wpsignal_no_jwt_secret',
				__( 'JWT secret not configured.', 'wpsignal' ),
				array( 'status' => 500 )
			);
		}

		$site_key = $this->config->site_key();
		if ( empty( $site_key ) ) {
			return new WP_Error(
				'wpsignal_not_configured',
				__( 'WPSignal is not configured.', 'wpsignal' ),
				array( 'status' => 500 )
			);
		}

		$user = wp_get_current_user();
		$now  = time();
		$exp  = $now + 300;

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

		$token    = $header . '.' . $payload . '.' . $signature;
		$channels = array( 'site:' . $site_id . ':events' );

		return rest_ensure_response( array(
			'token'    => $token,
			'channels' => $channels,
			'exp'      => $exp,
		) );
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
	 * @return WP_REST_Response|WP_Error Success response or error.
	 */
	public function handle_publish( WP_REST_Request $request ) {
		$channel = $request->get_param( 'channel' );
		$event   = $request->get_param( 'event' );
		$data    = $request->get_param( 'data' );

		if ( empty( $channel ) || empty( $event ) ) {
			return new WP_Error(
				'wpsignal_missing_params',
				__( 'Channel and event are required.', 'wpsignal' ),
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
	 * to wp_options via WPSignal_Config::save_registration().
	 *
	 * Called by the "Connect to WPSignal" button on the settings page.
	 *
	 * Response on success:
	 *
	 *     { "message": "Connected to WPSignal!", "site_key": "abc123..." }
	 *
	 * @param WP_REST_Request $request The incoming REST request.
	 * @return WP_REST_Response|WP_Error Success response or error.
	 */
	public function handle_connect( WP_REST_Request $request ) {
		$base_url = $this->config->base_url();
		$api_key  = $this->config->api_key();

		if ( empty( $base_url ) || empty( $api_key ) ) {
			return new WP_Error(
				'wpsignal_not_configured',
				__( 'Please save your Server URL and API Key first.', 'wpsignal' ),
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
				__( 'Invalid response from server.', 'wpsignal' ),
				array( 'status' => 502 )
			);
		}

		$this->config->save_registration( $data );

		return rest_ensure_response( array(
			'message'  => __( 'Connected to WPSignal!', 'wpsignal' ),
			'site_key' => $data['site_key'],
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
