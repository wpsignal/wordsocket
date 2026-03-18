<?php

/**
 * WPSignal\Connect - Browser-based OAuth-style connection flow.
 *
 * Registers two admin-post action hooks:
 *
 *   admin_post_wpsignal_oauth_start    : Generates a state nonce and redirects
 *                                        the admin's browser to the WPSignal
 *                                        dashboard authorize page.
 *
 *   admin_post_wpsignal_oauth_callback : Validates the returned state nonce,
 *                                        exchanges the authorization code for
 *                                        site credentials via a server-to-server
 *                                        POST to /api/connect/exchange, saves
 *                                        credentials to wp_options, then
 *                                        redirects back to the Settings page.
 *
 * The nopriv variant of the callback hook is also registered so the handler
 * fires even if the WordPress session has expired during the redirect round-trip.
 * The state nonce provides the CSRF protection in that case.
 *
 * @package WordSocket
 */

namespace WPSignal;

if (! defined('ABSPATH')) {
	exit;
}

class Connect
{

	/** @var Config Configuration accessor. */
	private $config;

	/**
	 * @param Config $config Configuration accessor.
	 */
	public function __construct(Config $config)
	{
		$this->config = $config;
	}

	/**
	 * Register admin-post action hooks.
	 *
	 * Called during WPS::boot().
	 *
	 * @return void
	 */
	public function init()
	{
		add_action('admin_post_wpsignal_oauth_start', array($this, 'handle_start'));
		add_action('admin_post_wpsignal_oauth_callback', array($this, 'handle_callback'));
		add_action('admin_post_nopriv_wpsignal_oauth_callback', array($this, 'handle_callback'));
	}

	/**
	 * Initiate the OAuth-style connect flow.
	 *
	 * Generates a cryptographically random state nonce, stores it as a
	 * 10-minute transient, then redirects the browser to the WPSignal
	 * dashboard authorize page with the nonce and a callback URL.
	 *
	 * Requires manage_options capability and a valid nonce.
	 *
	 * @return void
	 */
	public function handle_start()
	{
		if (! current_user_can('manage_options')) {
			wp_die(esc_html__('Permission denied.', 'wordsocket'));
		}

		check_admin_referer('wpsignal_oauth_start');

		$state = bin2hex(random_bytes(32));
		$was_set = set_transient('wpsignal_oauth_state', $state, 600);

		$callback_url = admin_url('admin-post.php?action=wpsignal_oauth_callback');

		$connect_url = add_query_arg(
			array(
				'state'        => $state,
				'callback_url' => rawurlencode($callback_url),
				'site_url'     => rawurlencode(home_url()),
				'site_name'    => rawurlencode(get_bloginfo('name')),
			),
			trailingslashit($this->config->base_url()) . 'dashboard/connect'
		);

		$base_host = wp_parse_url($this->config->base_url(), PHP_URL_HOST);
		add_filter(
			'allowed_redirect_hosts',
			function ($hosts) use ($base_host) {
				$hosts[] = $base_host;
				return $hosts;
			}
		);
		wp_safe_redirect($connect_url);
		exit;
	}

	/**
	 * Handle the redirect back from the WPSignal dashboard.
	 *
	 * The dashboard POSTs back to this handler with the following parameters:
	 *
	 *   wps_state (POST) : The state nonce originally sent by handle_start().
	 *   wps_code  (POST) : A one-time authorization code to exchange for credentials.
	 *   wps_error (GET)  : Set to any non-empty value when the user cancelled.
	 *
	 * Flow:
	 *   1. If wps_error is set, redirect with 'cancelled' notice and exit.
	 *   2. Validate the state nonce against the stored transient (CSRF check).
	 *   3. Exchange wps_code via POST to /api/connect/exchange.
	 *   4. Expect response: { site_key, publish_secret, jwt_secret }.
	 *   5. Save credentials via Config::save_connection() (does NOT store api_key).
	 *   6. Redirect to Settings page with 'connected' notice.
	 *
	 * Redirects with wps_notice query param on all outcomes:
	 *   connected      : Success.
	 *   cancelled      : User cancelled on the dashboard.
	 *   error_state    : State nonce missing or mismatched.
	 *   error_code     : Authorization code missing.
	 *   error_exchange : Server call to /api/connect/exchange failed.
	 *   error_data     : Server response missing required credential fields.
	 *
	 * Can run without a WordPress session (nopriv) because the state nonce
	 * provides the sole CSRF protection.
	 *
	 * @return void
	 */
	public function handle_callback()
	{
		$settings_url = admin_url('admin.php?page=wordsocket');

		// phpcs:disable WordPress.Security.NonceVerification -- CSRF protection is provided by the OAuth state
		// parameter (a 32-byte random value stored as a transient and verified via hash_equals() below).
		// WordPress nonces cannot be used here: the callback arrives from an external redirect and the
		// session may not be active (this handler is also registered as nopriv).
		$state = isset($_POST['wps_state']) ? sanitize_text_field(wp_unslash($_POST['wps_state'])) : '';
		$code  = isset($_POST['wps_code']) ? sanitize_text_field(wp_unslash($_POST['wps_code'])) : '';
		$error = isset($_GET['wps_error']) ? sanitize_text_field(wp_unslash($_GET['wps_error'])) : '';
		// phpcs:enable WordPress.Security.NonceVerification

		if ($error) {
			wp_safe_redirect(add_query_arg('wps_notice', 'cancelled', $settings_url));
			exit;
		}

		$stored_state = get_transient('wpsignal_oauth_state');
		delete_transient('wpsignal_oauth_state');

		if (empty($stored_state) || empty($state) || ! hash_equals($stored_state, $state)) {
			wp_safe_redirect(add_query_arg('wps_notice', 'error_state', $settings_url));
			exit;
		}

		if (empty($code)) {
			wp_safe_redirect(add_query_arg('wps_notice', 'error_code', $settings_url));
			exit;
		}

		$response = wp_remote_post(
			trailingslashit($this->config->base_url()) . 'api/connect/exchange',
			array(
				'timeout' => 10,
				'headers' => array('Content-Type' => 'application/json'),
				'body'    => wp_json_encode(array('code' => $code)),
			)
		);

		if (is_wp_error($response) || 200 !== (int) wp_remote_retrieve_response_code($response)) {
			wp_safe_redirect(add_query_arg('wps_notice', 'error_exchange', $settings_url));
			exit;
		}

		$data = json_decode(wp_remote_retrieve_body($response), true);

		if (empty($data['site_key']) || empty($data['publish_secret']) || empty($data['jwt_secret'])) {
			wp_safe_redirect(add_query_arg('wps_notice', 'error_data', $settings_url));
			exit;
		}

		$this->config->save_connection($data);

		wp_safe_redirect(add_query_arg('wps_notice', 'connected', $settings_url));
		exit;
	}
}
