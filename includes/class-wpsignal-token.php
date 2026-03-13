<?php

/**
 * WPSignal\Token - JWT minting and REST API endpoints.
 *
 * Registers REST API endpoints under the `wpsignal/v1` namespace:
 *
 *   POST /wp-json/wpsignal/v1/token      : Mint a short-lived connection JWT (any logged-in user).
 *   POST /wp-json/wpsignal/v1/connect    : Manual connection flow: register this site with the
 *                                          WPSignal server using an API key (admin only).
 *                                          POSTs to /api/sites/register with Bearer api_key.
 *   POST /wp-json/wpsignal/v1/disconnect : Remove this site from the WPSignal server and clear
 *                                          local credentials. Supports both manual (Bearer api_key)
 *                                          and automatic (publish_secret) auth (admin only).
 *   POST /wp-json/wpsignal/v1/publish    : Publish an event via PHP proxy (admin only).
 *   GET  /wp-json/wpsignal/v1/settings   : Read connection settings (admin only).
 *   POST /wp-json/wpsignal/v1/settings   : Save connection settings (admin only).
 *
 * Connection flows:
 *   - Automatic: handled by the Connect class via admin-post hooks. Redirects the admin
 *     to the WPSignal dashboard, which posts back a one-time code the plugin exchanges
 *     for credentials (site_key, publish_secret, jwt_secret). No API key is stored.
 *   - Manual: admin pastes their API key into the settings UI; this class POSTs it to
 *     /api/sites/register and saves all returned credentials including api_key.
 *
 * The token endpoint mints HS256 JWTs that browsers use to connect via WebSocket or SSE.
 * The JWT contains tenant_id, site_id, user_id, and allowed_channel_prefixes, all enforced
 * server-side.
 *
 * The publish endpoint acts as a server-side proxy so the HMAC site secret never reaches
 * the browser. Used by the Explorer debug page.
 *
 * @package WordSocket
 */

namespace WPSignal;

use WP_REST_Request, WP_Error, WP_REST_Response;

if (! defined('ABSPATH')) {
	exit;
}

class Token
{

	/** @var Config Configuration accessor. */
	private $config;

	/** @var Publisher Event publisher (used by the /publish proxy). */
	private $publisher;

	/**
	 * @param Config    $config    Configuration accessor.
	 * @param Publisher $publisher Event publisher for the /publish proxy.
	 */
	public function __construct(Config $config, Publisher $publisher)
	{
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
	public function register_routes()
	{
		register_rest_route('wpsignal/v1', '/token', array(
			'methods'             => 'POST',
			'callback'            => array($this, 'handle_token'),
			'permission_callback' => '__return_true',
		));

		register_rest_route('wpsignal/v1', '/connect', array(
			'methods'             => 'POST',
			'callback'            => array($this, 'handle_register'),
			'permission_callback' => function () {
				return current_user_can('manage_options');
			},
		));

		register_rest_route('wpsignal/v1', '/publish', array(
			'methods'             => 'POST',
			'callback'            => array($this, 'handle_publish'),
			'permission_callback' => function () {
				return current_user_can('manage_options');
			},
		));

		register_rest_route('wpsignal/v1', '/disconnect', array(
			'methods'             => 'POST',
			'callback'            => array($this, 'handle_disconnect'),
			'permission_callback' => function () {
				return current_user_can('manage_options');
			},
		));

		register_rest_route('wpsignal/v1', '/settings', array(
			array(
				'methods'             => 'GET',
				'callback'            => array($this, 'handle_get_settings'),
				'permission_callback' => function () {
					return current_user_can('manage_options');
				},
			),
			array(
				'methods'             => 'POST',
				'callback'            => array($this, 'handle_save_settings'),
				'args'                => array(
					'settings' => array(
						'type' => 'object',
						'properties' => array(
							'yjs_provider_enabled' => array('type' => 'boolean'),
							'is_rtc_enabled'       => array('type' => 'boolean'),
							'wp_version' 		   => array('type' => 'number'),
							'credential_source'    => array('type' => 'string'),
							'api_key' 			   => array('type' => 'string'),
							'site_key' 			   => array('type' => 'string'),
							'is_connected' 		   => array('type' => 'boolean'),
							'base_url' 		   	   => array('type' => 'string'),
						),
					),
				),
				'permission_callback' => function () {
					return current_user_can('manage_options');
				},
			),
		));
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
	public function mint()
	{
		$jwt_secret = $this->config->jwt_secret();
		if (empty($jwt_secret)) {
			return new WP_Error(
				'wpsignal_no_jwt_secret',
				__('JWT secret not configured.', 'wordsocket'),
				array('status' => 500)
			);
		}

		$site_key = $this->config->site_key();
		if (empty($site_key)) {
			return new WP_Error(
				'wpsignal_not_configured',
				__('WordSocket is not configured.', 'wordsocket'),
				array('status' => 500)
			);
		}

		$user      = wp_get_current_user();
		$now       = time();
		$exp       = $now + 300;
		$tenant_id = hash('sha256', 'tenant:' . $site_key);
		$site_id   = hash('sha256', 'site:' . $site_key);

		$header = self::base64url_encode(wp_json_encode(array(
			'alg' => 'HS256',
			'typ' => 'JWT',
		)));

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
			array('site:' . $site_id . ':events'),
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
			array('site:' . $site_id . ':'),
			$user->ID,
			$site_id
		);

		$payload = self::base64url_encode(wp_json_encode(array(
			'tenant_id'                => $tenant_id,
			'site_id'                  => $site_id,
			'user_id'                  => (string) $user->ID,
			'allowed_channel_prefixes' => $allowed_prefixes,
			'iat'                      => $now,
			'exp'                      => $exp,
		)));

		$signature = self::base64url_encode(
			hash_hmac('sha256', $header . '.' . $payload, $jwt_secret, true)
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
	 * @param WP_REST_Request $request The incoming REST request.
	 * @return \WP_REST_Response|\WP_Error Token response or error.
	 */
	public function handle_token(WP_REST_Request $request)
	{
		$result = $this->mint();
		if (is_wp_error($result)) {
			return $result;
		}
		return rest_ensure_response($result);
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
	public function handle_publish(WP_REST_Request $request)
	{
		$channel = $request->get_param('channel');
		$event   = $request->get_param('event');
		$data    = $request->get_param('data');

		if (empty($channel) || empty($event)) {
			return new WP_Error(
				'wpsignal_missing_params',
				__('Channel and event are required.', 'wordsocket'),
				array('status' => 400)
			);
		}

		$result = $this->publisher->publish($channel, $event, $data ? $data : array());

		if (is_wp_error($result)) {
			return $result;
		}

		return rest_ensure_response(array('ok' => true));
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
	public function handle_register(WP_REST_Request $request)
	{
		$base_url = $this->config->base_url();
		$api_key  = $request->get_param('api_key');

		if (empty($api_key)) {
			return new WP_Error(
				'wpsignal_not_configured',
				__('API Key is empty, please include it and try again.', 'wordsocket'),
				array('status' => 400)
			);
		}

		if (strlen($api_key) !== 64) {
			return new WP_Error(
				'wpsignal_invalid_api_key',
				__('API Key is invalid, please include a valid API Key and try again.', 'wordsocket'),
				array('status' => 400)
			);
		}

		$response = wp_remote_post(trailingslashit($base_url) . 'api/sites/register', array(
			'timeout' => 10,
			'headers' => array(
				'Content-Type'  => 'application/json',
				'Authorization' => 'Bearer ' . $api_key,
			),
			'body' => wp_json_encode(array(
				'site_url'  => home_url(),
				'site_name' => get_bloginfo('name'),
			)),
		));

		if (is_wp_error($response)) {
			return new WP_Error(
				'wpsignal_connect_failed',
				$response->get_error_message(),
				array('status' => 502)
			);
		}

		$code = wp_remote_retrieve_response_code($response);
		if ($code !== 200) {
			$body       = wp_remote_retrieve_body($response);
			$error_data = json_decode($body, true);
			$error_code = is_array($error_data) && isset($error_data['error'])
				? 'wpsignal_' . $error_data['error']
				: 'wpsignal_connect_failed';
			$message    = is_array($error_data) && isset($error_data['message'])
				? $error_data['message']
				: sprintf('HTTP %d', $code);
			return new WP_Error(
				$error_code,
				$message,
				array('status' => $code)
			);
		}

		$data = json_decode(wp_remote_retrieve_body($response), true);

		if (empty($data['site_key']) || empty($data['publish_secret']) || empty($data['jwt_secret'])) {
			return new WP_Error(
				'wpsignal_invalid_response',
				__('Invalid response from server.', 'wordsocket'),
				array('status' => 502)
			);
		}

		$data['api_key'] = $api_key;
		$this->config->save_registration($data);

		return rest_ensure_response(array(
			'message'  => __('Connection settings validated!', 'wordsocket'),
			'site_key' => $data['site_key'],
		));
	}

	/**
	 * Disconnect this site: delete the site from the WPSignal server and clear local credentials.
	 *
	 * POSTs to {base_url}/api/sites/unregister. Supports two auth paths:
	 *
	 *   - Manual flow: sends `Authorization: Bearer {api_key}` header. The server looks up the
	 *     user by API key and deletes their site.
	 *   - Automatic flow: no api_key is stored locally, so the request is authenticated by
	 *     including `publish_secret` in the request body. The server verifies it matches the
	 *     stored site config and deletes the site unconditionally.
	 *
	 * If site_key is empty (already disconnected locally), the server call is skipped.
	 * Returns WP_Error if the HTTP request itself fails (network error).
	 *
	 * Response on success:
	 *
	 *     { "ok": true }
	 *
	 * @param WP_REST_Request $request The incoming REST request.
	 * @return WP_REST_Response|\WP_Error Success response or error.
	 */
	public function handle_disconnect(WP_REST_Request $request)
	{
		$base_url       = $this->config->base_url();
		$api_key        = $this->config->api_key();
		$site_key       = $this->config->site_key();
		$publish_secret = $this->config->site_secret();

		if (!empty($site_key)) {
			// Build request: prefer API key auth (manual flow); fall back to
			// publish_secret auth (automatic flow where no api_key is stored).
			$args = array(
				'timeout' => 10,
				'headers' => array('Content-Type' => 'application/json'),
				'body'    => wp_json_encode(array(
					'site_key'       => $site_key,
					'publish_secret' => $publish_secret,
				)),
			);

			if (!empty($api_key)) {
				$args['headers']['Authorization'] = 'Bearer ' . $api_key;
			}

			$response = wp_remote_post(trailingslashit($base_url) . 'api/sites/unregister', $args);

			if (is_wp_error($response)) {
				return new WP_Error(
					'wpsignal_disconnect_failed',
					$response->get_error_message(),
					array('status' => 502)
				);
			}
		}

		$this->config->clear_registration();

		return rest_ensure_response(array('ok' => true));
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
	public function handle_get_settings(WP_REST_Request $request)
	{
		$is_connected = $this->config->is_configured();

		if ($is_connected) {
			$is_connected = $this->verify_site_exists();
		}

		return rest_ensure_response(array(
			'base_url'          => $this->config->base_url(),
			'api_key'           => $this->config->api_key(),
			'site_key'          => $is_connected ? $this->config->site_key() : '',
			'is_connected'      => $is_connected,
			'yjs_provider_enabled' => $this->config->yjs_provider_enabled(),
			'is_rtc_enabled'    => (bool) get_option('wp_enable_real_time_collaboration', false),
			'wp_version'        => (float) wp_get_wp_version(),
			'credential_source' => $this->config->credential_source(),
		));
	}

	/**
	 * Save settings.
	 * 
	 * @param WP_REST_Request $request The incoming REST request.
	 * @return WP_REST_Response|WP_Error 
	 */
	public function handle_save_settings(WP_REST_Request $request)
	{
		$yjs_provider_enabled = $request->get_param('yjs_provider_enabled');
		update_option('wpsignal_yjs_provider_enabled', $yjs_provider_enabled );

		return rest_ensure_response([
			'yjs_provider_enabled' => $yjs_provider_enabled,
		]);
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
	private function verify_site_exists()
	{
		$body         = '{}';
		$timestamp_ms = (string) round(microtime(true) * 1000);
		$url          = trailingslashit($this->config->base_url()) . 'publish';

		$response = wp_remote_post($url, array(
			'timeout' => 3,
			'headers' => array(
				'Content-Type'     => 'application/json',
				'X-WP-Signal-Key'  => $this->config->site_key(),
				'X-WP-Signal-Ts'   => $timestamp_ms,
				'X-WP-Signal-Sign' => 'dummy',
			),
			'body' => $body,
		));

		if (is_wp_error($response)) {
			return true; // Network error: assume still connected.
		}

		$response_body = wp_remote_retrieve_body($response);
		$data          = json_decode($response_body, true);

		if (is_array($data) && isset($data['error']) && $data['error'] === 'unknown_site_key') {
			return false; // Site was deleted on the server.
		}

		// 'invalid_signature' means the site key is known: expected with a dummy sig.
		return true;
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
	public static function base64url_encode($data)
	{
		return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
	}

}
