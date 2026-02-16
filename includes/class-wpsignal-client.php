<?php
/**
 * WPSignal\Client — frontend script enqueue for logged-in users.
 *
 * Enqueues `client.js` on the frontend when:
 *   1. The current user is logged in.
 *   2. The plugin is configured (base_url is set).
 *
 * The script connects to the WPSignal server via WebSocket (with SSE fallback)
 * and dispatches `wpsignal:{event}` CustomEvents on the document. Theme or
 * plugin JavaScript can listen for these events:
 *
 *     document.addEventListener( 'wpsignal:post.updated', function ( e ) {
 *         console.log( e.detail.data.post_title );
 *     } );
 *
 * Localized data (`wpSignalConfig`):
 *   - restUrl — REST endpoint for minting tokens (POST /wpsignal/v1/token)
 *   - nonce   — WordPress REST nonce for authentication
 *   - baseUrl — WPSignal server URL for WebSocket/SSE connections
 *
 * @package WPSignal
 */

 namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Client {

	/** @var Config Configuration accessor. */
	private $config;

	/**
	 * @param Config $config Configuration accessor.
	 */
	public function __construct( Config $config ) {
		$this->config = $config;
	}

	/**
	 * Hook into wp_enqueue_scripts.
	 *
	 * Called during WPSignal::boot().
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ) );
	}

	/**
	 * Conditionally enqueue the client script.
	 *
	 * Only enqueues when the user is logged in and the plugin is configured.
	 * The script is loaded in the footer with no dependencies.
	 *
	 * @return void
	 */
	public function enqueue() {
		if ( ! is_user_logged_in() ) {
			return;
		}

		$base_url = $this->config->base_url();
		if ( empty( $base_url ) ) {
			return;
		}

		wp_enqueue_script(
			'wpsignal-client',
			URL . 'assets/client.js',
			array(),
			VERSION,
			true
		);

		wp_localize_script( 'wpsignal-client', 'wpSignalConfig', array(
			'restUrl' => rest_url( 'wpsignal/v1/token' ),
			'nonce'   => wp_create_nonce( 'wp_rest' ),
			'baseUrl' => esc_url( $base_url ),
		) );
	}
}
