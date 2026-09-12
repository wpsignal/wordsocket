<?php
/**
 * WPSignal\Token - JWT minting and REST API endpoints.
 *
 * The publish endpoint acts as a server-side proxy so the HMAC site secret never reaches
 * the browser. Used by the Explorer debug page.
 *
 * @package WordSocket
 */

namespace WPSignal;

use WP_REST_Request, WP_Error, WP_REST_Response;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * JWT minting and REST API endpoints.
 */
class Token {
	/**
	 * Configuration accessor.
	 *
	 * @var Config
	 */
	private $config;

	/**
	 * Event publisher (used by the /publish proxy).
	 *
	 * @var Publisher
	 */
	private $publisher;

	/**
	 * Constructor.
	 *
	 * @param Config    $config    Configuration accessor.
	 * @param Publisher $publisher Event publisher for the /publish proxy.
	 * @return void
	 */
	public function __construct( Config $config, Publisher $publisher ) {
		$this->config    = $config;
		$this->publisher = $publisher;
	}

	/**
	 * Register all WordSocket REST routes.
	 *
	 * Hooked to `rest_api_init` during WPSignal::boot().
	 *
	 * @return void
	 */
	public function register_routes() {

		$permission_callback = fn() => current_user_can( 'manage_options' );

		// Token minting follows the same rule as the frontend client enqueue:
		// logged-in users only unless a site opts into public clients via the
		// `wpsignal_allow_client` filter. Anonymous callers otherwise get 401.
		register_rest_route(
			'wpsignal/v1',
			'/token',
			array(
				'methods'             => 'GET, POST',
				'callback'            => array( $this, 'handle_token' ),
				'permission_callback' => static function () {
					return (bool) apply_filters( 'wpsignal_allow_client', is_user_logged_in() );
				},
			)
		);

		register_rest_route(
			'wpsignal/v1',
			'/connect',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'handle_register' ),
				'permission_callback' => $permission_callback,
			)
		);

		register_rest_route(
			'wpsignal/v1',
			'/publish',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'handle_publish' ),
				'permission_callback' => $permission_callback,
			)
		);

		register_rest_route(
			'wpsignal/v1',
			'/disconnect',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'handle_disconnect' ),
				'permission_callback' => $permission_callback,
			)
		);

		register_rest_route(
			'wpsignal/v1',
			'/settings',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'handle_get_settings' ),
					'permission_callback' => $permission_callback,
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'handle_post_settings' ),
					'args'                => array(
						'yjs_provider_enabled' => array(
							'type'     => 'boolean',
							'required' => true,
						),
					),
					'permission_callback' => $permission_callback,
				),
			)
		);
	}

	/**
	 * Mint a short-lived connection JWT for the current user.
	 *
	 * Can be called directly from PHP (e.g. to embed the token in a page) or
	 * via the REST endpoint. Returns a plain array on success or WP_Error on
	 * failure.
	 *
	 * @return array|\WP_Error Token data array or error.
	 */
	public function mint() {
		$jwt_secret = $this->config->jwt_secret();
		if ( empty( $jwt_secret ) ) {
			return new WP_Error(
				'wpsignal_no_jwt_secret',
				__( 'JWT secret not configured.', 'wordsocket' ),
				array( 'status' => 500 )
			);
		}

		$site_key = $this->config->site_key();
		if ( empty( $site_key ) ) {
			return new WP_Error(
				'wpsignal_not_configured',
				__( 'WordSocket is not configured.', 'wordsocket' ),
				array( 'status' => 500 )
			);
		}

		$user      = wp_get_current_user();
		$now       = time();
		$exp       = $now + 300;
		$tenant_id = hash( 'sha256', 'tenant:' . $site_key );
		$site_id   = hash( 'sha256', 'site:' . $site_key );

		$header = self::base64url_encode(
			wp_json_encode(
				array(
					'alg' => 'HS256',
					'typ' => 'JWT',
				)
			)
		);

		/**
		 * Filters the channels the client auto-subscribes to on connect.
		 *
		 * Plugins can append their own channels so they are included in the
		 * initial WebSocket/SSE subscription without a separate subscribe call.
		 *
		 * @param string[] $channels  Default channels for this site.
		 * @param int      $user_id   Current user ID.
		 * @param string   $site_id   Hashed site identifier from the JWT.
		 */
		$channels = apply_filters(
			'wpsignal_token_channels',
			array( 'site:' . $site_id . ':events' ),
			$user->ID,
			$site_id
		);

		/**
		 * Filters the channel prefixes the JWT allows the client to subscribe to.
		 *
		 * The WPSignal server rejects subscribe/publish frames whose channel does
		 * not start with one of these prefixes. Add a prefix here whenever you
		 * add channels via the `wpsignal_token_channels` filter that fall outside
		 * the default `site:{site_id}:` namespace.
		 *
		 * @param string[] $prefixes  Default allowed prefixes.
		 * @param int      $user_id   Current user ID.
		 * @param string   $site_id   Hashed site identifier from the JWT.
		 */
		$allowed_prefixes = apply_filters(
			'wpsignal_token_channel_prefixes',
			array( 'site:' . $site_id . ':' ),
			$user->ID,
			$site_id
		);

		$payload = self::base64url_encode(
			wp_json_encode(
				array(
					'tenant_id'                => $tenant_id,
					'site_id'                  => $site_id,
					'user_id'                  => (string) $user->ID,
					'allowed_channel_prefixes' => $allowed_prefixes,
					'iat'                      => $now,
					'exp'                      => $exp,
				)
			)
		);

		$signature = self::base64url_encode(
			hash_hmac( 'sha256', $header . '.' . $payload, $jwt_secret, true )
		);

		return array(
			'token'    => $header . '.' . $payload . '.' . $signature,
			'channels' => $channels,
			'exp'      => $exp,
		);
	}

	/**
	 * REST handler: mint a token for the current user and return it as JSON.
	 *
	 * @return \WP_REST_Response|\WP_Error Token response or error.
	 */
	public function handle_token() {
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
	 * reaches the browser. Used by the Explorer page.
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
				__( 'Channel and event are required.', 'wordsocket' ),
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
	 * @param WP_REST_Request $request The incoming REST request.
	 * @return WP_REST_Response|\WP_Error Success response or error.
	 */
	public function handle_register( WP_REST_Request $request ) {
		$base_url = $this->config->base_url();
		$api_key  = $request->get_param( 'api_key' );

		if ( empty( $api_key ) ) {
			return new WP_Error(
				'wpsignal_not_configured',
				__( 'API Key is empty, please include it and try again.', 'wordsocket' ),
				array( 'status' => 400 )
			);
		}

		if ( self::mask_api_key( $this->config->api_key() ) === $api_key ) {
			$api_key = $this->config->api_key();
		}

		if ( strlen( $api_key ) !== 64 ) {
			return new WP_Error(
				'wpsignal_invalid_api_key',
				__( 'API Key is invalid, please include a valid API Key and try again.', 'wordsocket' ),
				array( 'status' => 400 )
			);
		}

		$response = wp_remote_post(
			trailingslashit( $base_url ) . 'api/sites/register',
			array(
				'timeout' => 10,
				'headers' => array(
					'Content-Type'  => 'application/json',
					'Authorization' => 'Bearer ' . $api_key,
				),
				'body'    => wp_json_encode(
					array(
						'site_url'  => home_url(),
						'site_name' => get_bloginfo( 'name' ),
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'wpsignal_connect_failed',
				$response->get_error_message(),
				array( 'status' => 502 )
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( 200 !== $code ) {
			return self::remote_error( $response, 'connect_failed' );
		}

		$data = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( empty( $data['site_key'] ) || empty( $data['publish_secret'] ) || empty( $data['jwt_secret'] ) ) {
			return new WP_Error(
				'wpsignal_invalid_response',
				__( 'Invalid response from server.', 'wordsocket' ),
				array( 'status' => 502 )
			);
		}

		$data['api_key'] = $api_key;
		$this->config->save_registration( $data );

		return rest_ensure_response(
			array(
				'message'  => __( 'Connection settings validated!', 'wordsocket' ),
				'site_key' => $data['site_key'],
			)
		);
	}

	/**
	 * Disconnect this site: archive it on the WPSignal server and clear local credentials.
	 *
	 * POSTs to {base_url}/api/sites/unregister. Local credentials are kept (and a
	 * `WP_Error` returned) when the request fails or the server refuses, so the
	 * user can retry. A `not_found`, `invalid_api_key`, or `unknown_site_key`
	 * refusal means the server already forgot the site or the key, which is as
	 * disconnected as it gets (see `GONE_ON_DISCONNECT`).
	 *
	 * @return WP_REST_Response|\WP_Error Success response or error.
	 */
	public function handle_disconnect() {
		$base_url       = $this->config->base_url();
		$api_key        = $this->config->api_key();
		$site_key       = $this->config->site_key();
		$publish_secret = $this->config->site_secret();

		if ( ! empty( $site_key ) ) {
			$args = array(
				'timeout' => 10,
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode(
					array(
						'site_key'       => $site_key,
						'publish_secret' => $publish_secret,
					)
				),
			);

			// For manual flow, add API key authentication header.
			if ( ! empty( $api_key ) ) {
				$args['headers']['Authorization'] = 'Bearer ' . $api_key;
			}

			$response = wp_remote_post( trailingslashit( $base_url ) . 'api/sites/unregister', $args );

			if ( is_wp_error( $response ) ) {
				return new WP_Error(
					'wpsignal_disconnect_failed',
					$response->get_error_message(),
					array( 'status' => 502 )
				);
			}

			$code = (int) wp_remote_retrieve_response_code( $response );
			if ( $code < 200 || $code >= 300 ) {
				$error = self::remote_error( $response, 'disconnect_failed' );
				// A site the server has already forgotten, or a key it no longer
				// accepts (regenerated in the dashboard), cannot be disconnected
				// any further: clearing the local copy is the whole job.
				if ( ! in_array( $error->get_error_code(), self::GONE_ON_DISCONNECT, true ) ) {
					return $error;
				}
			}
		}

		$this->config->clear_registration();

		return rest_ensure_response( array( 'ok' => true ) );
	}

	/**
	 * Return current connection settings.
	 *
	 * When the site appears locally configured, verifies the site_key still
	 * exists on the server via a lightweight publish (see `verify_site_exists`).
	 * The API key is never sent back in full: only a `****` mask plus its last
	 * four characters, which `handle_register` accepts as "reuse the stored key".
	 *
	 * @return WP_REST_Response Settings response.
	 */
	public function handle_get_settings() {
		$is_connected = $this->config->is_configured();

		if ( $is_connected ) {
			$is_connected = $this->verify_site_exists();
		}

		return rest_ensure_response(
			array(
				'base_url'             => $this->config->base_url(),
				'api_key'              => self::mask_api_key( $this->config->api_key() ),
				'site_key'             => $is_connected ? $this->config->site_key() : '',
				'is_connected'         => $is_connected,
				'yjs_provider_enabled' => $this->config->yjs_provider_enabled(),
				'credential_source'    => $this->config->credential_source(),
				'last_error'           => $this->last_publish_error(),
			)
		);
	}

	/**
	 * Save settings.
	 *
	 * @param WP_REST_Request $request The incoming REST request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function handle_post_settings( WP_REST_Request $request ) {
		$yjs_provider_enabled = rest_sanitize_boolean( $request->get_param( 'yjs_provider_enabled' ) );
		update_option( 'wpsignal_yjs_provider_enabled', $yjs_provider_enabled );

		return rest_ensure_response(
			array(
				'yjs_provider_enabled' => $yjs_provider_enabled,
			)
		);
	}

	/**
	 * The last publish failure for the settings UI, or null.
	 *
	 * @return array|null array{code, message, time}.
	 */
	private function last_publish_error() {
		$error = Notices::last();
		if ( ! $error ) {
			return null;
		}
		return array(
			'code'    => $error['code'],
			'message' => Notices::describe( $error ),
			'time'    => (int) $error['time'],
		);
	}

	/**
	 * Disconnect refusals that mean there is nothing left to disconnect on the
	 * server, so local credentials are cleared anyway.
	 */
	private const GONE_ON_DISCONNECT = array(
		'wpsignal_not_found',
		'wpsignal_invalid_api_key',
		'wpsignal_unknown_site_key',
	);

	/**
	 * Server error codes that mean this site's credentials are no longer valid.
	 *
	 * A publish with a dummy signature answers `invalid_signature` for a live
	 * site; anything in this list means the registration is gone or locked.
	 */
	private const DISCONNECTED_CODES = array(
		'unknown_site_key',
		'invalid_token',
		'site_not_found',
		'account_deactivated',
		'invalid_api_key',
	);

	/**
	 * Verify the registered site still exists on the WPSignal server.
	 *
	 * Sends a publish with a dummy signature and inspects the error code:
	 * `invalid_signature` means the site is live; a code in
	 * `DISCONNECTED_CODES` means it is not. Network errors assume connected.
	 *
	 * @return bool True if the site still exists (or server is unreachable).
	 */
	private function verify_site_exists() {
		$body         = '{}';
		$timestamp_ms = (string) round( microtime( true ) * 1000 );
		$url          = trailingslashit( $this->config->base_url() ) . 'publish';

		$response = wp_remote_post(
			$url,
			array(
				'timeout' => 3,
				'headers' => array(
					'Content-Type'     => 'application/json',
					'X-WP-Signal-Key'  => $this->config->site_key(),
					'X-WP-Signal-Ts'   => $timestamp_ms,
					'X-WP-Signal-Sign' => 'dummy',
				),
				'body'    => $body,
			)
		);

		if ( is_wp_error( $response ) ) {
			return true; // Network error: assume still connected.
		}

		$response_body = wp_remote_retrieve_body( $response );
		$data          = json_decode( $response_body, true );

		$error = is_array( $data ) && isset( $data['error'] ) ? (string) $data['error'] : '';

		return ! in_array( $error, self::DISCONNECTED_CODES, true );
	}

	/**
	 * Turn a non-2xx server response into a `WP_Error` carrying the server's
	 * own code (prefixed `wpsignal_`) and message.
	 *
	 * @param array  $response wp_remote_* response.
	 * @param string $fallback Code to use when the body has none.
	 * @return WP_Error
	 */
	private static function remote_error( $response, $fallback ) {
		$code = (int) wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $data ) ) {
			$data = array();
		}
		$error_code = ! empty( $data['error'] ) ? 'wpsignal_' . $data['error'] : 'wpsignal_' . $fallback;
		$message    = ! empty( $data['message'] )
			? (string) $data['message']
			/* translators: %d: HTTP status code */
			: sprintf( __( 'HTTP %d', 'wordsocket' ), $code );

		return new WP_Error( $error_code, $message, array( 'status' => $code ) );
	}

	/**
	 * `****` plus the last four characters, or '' when no key is stored.
	 *
	 * @param string $api_key Full key.
	 * @return string
	 */
	public static function mask_api_key( $api_key ) {
		if ( '' === (string) $api_key ) {
			return '';
		}
		return '****' . substr( $api_key, -4 );
	}

	/**
	 * Base64url encoding (RFC 7515).
	 *
	 * @param string $data Raw binary or string data to encode.
	 * @return string Base64url-encoded string.
	 */
	public static function base64url_encode( $data ) {
		return rtrim( strtr( base64_encode( $data ), '+/', '-_' ), '=' );
	}
}
