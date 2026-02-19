<?php
/**
 * WPSignal\Client — script enqueue for logged-in users (frontend + admin).
 *
 * Enqueues `client.js` on the frontend and admin when:
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

	/** @var Token Token minter. */
	private $token;

	/**
	 * @param Config $config Configuration accessor.
	 * @param Token  $token  Token minter (used to embed an initial JWT server-side).
	 */
	public function __construct( Config $config, Token $token ) {
		$this->config = $config;
		$this->token  = $token;
	}

	/**
	 * Hook into wp_enqueue_scripts and admin_enqueue_scripts.
	 *
	 * Called during WPSignal::boot().
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );
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
		if ( ! apply_filters( 'wpsignal_allow_client', is_user_logged_in() ) ) {
			return;
		}

		$base_url = $this->config->base_url();
		if ( empty( $base_url ) ) {
			return;
		}

		$asset_file = DIR . 'build/client.asset.php';
		$asset      = file_exists( $asset_file ) ? require $asset_file : array( 'dependencies' => array(), 'version' => VERSION );

		wp_enqueue_script(
			'wpsignal',
			URL . 'build/client.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		// Mint a token server-side so client.js can connect immediately without
		// an extra REST round-trip. The REST endpoint is then only used for
		// refresh, protected by the nonce below.
		$localize = array(
			'restUrl' => rest_url( 'wpsignal/v1/token' ),
			'nonce'   => wp_create_nonce( 'wp_rest' ),
			'baseUrl' => esc_url( $base_url ),
		);

		$token_data = $this->token->mint();
		if ( ! is_wp_error( $token_data ) ) {
			$localize['token']    = $token_data['token'];
			$localize['channels'] = $token_data['channels'];
			$localize['exp']      = $token_data['exp'];
		}

		wp_localize_script( 'wpsignal', 'wpSignalConfig', $localize );
	}
}
