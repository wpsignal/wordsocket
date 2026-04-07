<?php
/**
 * WPSignal\Client: script enqueue for logged-in users (frontend + admin).
 *
 * @package WordSocket
 */

namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Client: script enqueue for logged-in users (frontend + admin).
 */
class Client {

	/**
	 * Configuration accessor.
	 *
	 * @var Config
	 */
	private $config;

	/**
	 * Token minter.
	 *
	 * @var Token Token minter (used to embed an initial JWT server-side).
	 */
	private $token;

	/**
	 * Constructor.
	 *
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
		add_action( 'enqueue_block_editor_assets', array( $this, 'enqueue_yjs_provider' ) );
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
		/**
		 * Controls whether the WordSocket client script is enqueued for the current request.
		 *
		 * Return `false` to prevent the script from loading (e.g. on specific post types
		 * or for guest users). Return `true` to force-load it regardless of login state.
		 *
		 * @TODO: Should this be configurable through the admin UI?
		 *
		 * @param bool $allow Default: `is_user_logged_in()`.
		 * @usage: load for all visitors:
		 * ```php
		 *     add_filter( 'wpsignal_allow_client', '__return_true' );
		 * ```
		 */
		$allow_client = apply_filters( 'wpsignal_allow_client', is_user_logged_in() );
		if ( ! $allow_client ) {
			return;
		}

		$base_url = $this->config->base_url();
		if ( empty( $base_url ) ) {
			return;
		}

		$asset_file = DIR . 'build/client.asset.php';
		$asset      = file_exists( $asset_file ) ? require $asset_file : array(
			'dependencies' => array(),
			'version'      => VERSION,
		);

		wp_enqueue_script(
			'wpsignal',
			URL . 'build/client.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		/*
		 * Mint a token server-side so client.js can connect immediately without
		 * an extra REST call. The REST endpoint is then only used for token
		 * refresh, protected by the nonce below.
		 */
		$localize = array(
			'baseUrl'        => esc_url( $base_url ),
			'isSsl'          => is_ssl(),
			'wpVersion'      => (float) wp_get_wp_version(),
			'isConstant'     => $this->config->credential_source() === 'constant',
			'isWpRtcEnabled' => ( defined( 'WP_COLLABORATION_ENABLED' ) && (bool) WP_COLLABORATION_ENABLED ) ||
									(bool) get_option( 'wp_collaboration_enabled', false ),
			'restUrl'        => rest_url( 'wpsignal/v1/token' ),
			'nonce'          => wp_create_nonce( 'wp_rest' ),
			'debug'          => ( defined( 'WP_ENVIRONMENT_TYPE' ) && WP_ENVIRONMENT_TYPE !== 'production' ),
		);

		$token_data = $this->token->mint();
		if ( ! is_wp_error( $token_data ) ) {
			$localize['token']    = $token_data['token'];
			$localize['channels'] = $token_data['channels'];
			$localize['exp']      = $token_data['exp'];
			/**
			 * Forces the client to use SSE instead of WebSocket. Mainly for development purposes.
			 *
			 * Return `true` to disable WebSocket and fall back to Server-Sent Events.
			 * Useful in environments where WebSocket connections are blocked.
			 *
			 * @param bool $force Default: `false`.
			 * @usage: force SSE transport:
			 * ```php
			 *     add_filter( 'wpsignal_force_sse', '__return_true' );
			 * ```
			 */
			$force_sse            = apply_filters( 'wpsignal_force_sse', false );
			$localize['forceSSE'] = $force_sse;
		}

		/**
		 * Derive the encryption key server-side and pass the base64-encoded raw
		 * bytes to the browser. client.js imports this with SubtleCrypto and uses
		 * it to decrypt incoming "encrypted" messages before dispatching events.
		 */
		$enc_key = $this->config->encryption_key();
		if ( ! empty( $enc_key ) ) {
			$localize['encryptionKey'] = base64_encode( $enc_key );
		}

		wp_add_inline_script( 'wpsignal', 'window.wpSignalConfig = ' . wp_json_encode( $localize ) . ';', 'before' );
	}

	/**
	 * Enqueue the Yjs sync provider in the block editor (WordPress 7.0+).
	 *
	 * Registers the WordSocket provider creator with the `sync.providers` filter
	 * so Gutenberg can use WPSignal WebSocket connections for real-time
	 * collaborative editing instead of the default HTTP polling transport.
	 *
	 * Only enqueued when:
	 *   1. The plugin is configured (base_url is set).
	 *   2. The @wordpress/sync package is available (WP 7.0+).
	 *   3. The wpsignal client script is already enqueued (connection exists).
	 *
	 * @return void
	 */
	public function enqueue_yjs_provider() {
		if ( ! $this->config->is_wp_sync_available() ) {
			return;
		}

		if ( ! $this->config->yjs_provider_enabled() ) {
			return;
		}

		if ( empty( $this->config->base_url() ) ) {
			return;
		}

		$site_key = $this->config->site_key();
		if ( empty( $site_key ) ) {
			return;
		}

		$asset_file = DIR . 'build/yjs-provider.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}

		$asset = require $asset_file;
		$deps  = array_merge( $asset['dependencies'], array( 'wpsignal', 'wp-hooks' ) );

		wp_enqueue_script(
			'wpsignal-yjs-provider',
			URL . 'build/yjs-provider.js',
			$deps,
			$asset['version'],
			true
		);

		/**
		 * Compute site_id the same way as Token::mint() so the Yjs channel
		 * prefix matches the JWT's allowed_channel_prefixes ('site:{site_id}:').
		 */
		$site_id = hash( 'sha256', 'site:' . $site_key );

		wp_localize_script(
			'wpsignal-yjs-provider',
			'wpSignalYjsConfig',
			array(
				'channelPrefix' => 'site:' . $site_id . ':yjs:',
			)
		);
	}
}
