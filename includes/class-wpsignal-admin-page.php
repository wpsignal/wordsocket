<?php
/**
 * WPSignal\Admin_Page - WordPress admin settings page and menu registration.
 *
 * Registers a top-level "WordSocket" admin menu with two subpages:
 *   - Settings: React SPA with Connection and Triggers tabs.
 *   - Monitor : interactive debug/test page (delegated to Monitor_Page).
 *
 * @package WordSocket
 */

 namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Admin_Page {

	/** @var Config Configuration accessor. */
	private $config;

	/** @var Monitor_Page Monitor subpage handler. */
	private $monitor;

	/**
	 * @param Config $config Configuration accessor.
	 */
	public function __construct( Config $config ) {
		$this->config  = $config;
		$this->monitor = new Monitor_Page( $config );
	}

	/**
	 * Initialize admin hooks.
	 *
	 * Called during WPSignal::boot() when is_admin() is true.
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
	}

	/**
	 * Register the top-level WordSocket menu and subpages.
	 *
	 * Creates:
	 *   - WordSocket (top-level, dashicons-rss)
	 *     - Settings (React app: Connection + Triggers tabs)
	 *     - Monitor  (renamed from Monitor)
	 *
	 * @return void
	 */
	public function register_menu() {
		add_menu_page(
			__( 'WordSocket', 'wordsocket' ),
			__( 'WordSocket', 'wordsocket' ),
			'manage_options',
			'wordsocket',
			array( $this, 'render_settings_page' ),
			$this->get_menu_icon(),
			80
		);

		add_submenu_page(
			'wordsocket',
			__( 'WordSocket Settings', 'wordsocket' ),
			__( 'Settings', 'wordsocket' ),
			'manage_options',
			'wordsocket',
			array( $this, 'render_settings_page' )
		);

		add_submenu_page(
			'wordsocket',
			__( 'WordSocket Monitor', 'wordsocket' ),
			__( 'Monitor', 'wordsocket' ),
			'manage_options',
			'wordsocket-monitor',
			array( $this->monitor, 'render_page' )
		);
	}

	/**
	 * Menu icon for the top-level WordSocket item.
	 *
	 * Returns the URL to the plugin SVG icon. Alternatively you can return a
	 * data URI: 'data:image/svg+xml;base64,' . base64_encode( $svg_markup )
	 *
	 * @return string
	 */
	private function get_menu_icon() {
		$svg = '<svg width="800" height="800" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M18 7a7.67 7.67 0 0 0-6 3.19A7.67 7.67 0 0 0 6 7c-3.687 0-5 2.583-5 5 0 3.687 2.583 5 5 5a7.67 7.67 0 0 0 6-3.19A7.67 7.67 0 0 0 18 17c2.417 0 5-1.313 5-5 0-2.417-1.313-5-5-5M6 15a2.69 2.69 0 0 1-3-3 2.69 2.69 0 0 1 3-3c2.579 0 4.225 2.065 4.837 3-.612.935-2.258 3-4.837 3m12 0c-2.579 0-4.225-2.065-4.837-3 .612-.935 2.258-3 4.837-3a2.69 2.69 0 0 1 3 3 2.69 2.69 0 0 1-3 3"/></svg>';
		return 'data:image/svg+xml;base64,' . base64_encode( $svg );
	}

	/**
	 * Render the Settings page: mounts the React app.
	 *
	 * Enqueues build/settings.js + build/settings.css, localizes configuration
	 * data, and renders the mount point div.
	 *
	 * @return void
	 */
	public function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$asset_file = DIR . 'build/settings.asset.php';
		$asset      = file_exists( $asset_file ) ? require $asset_file : array( 'dependencies' => array(), 'version' => VERSION );

		wp_enqueue_script(
			'wpsignal-settings',
			URL . 'build/settings.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_enqueue_style(
			'wpsignal-settings',
			URL . 'build/settings.css',
			array( 'wp-components' ),
			$asset['version']
		);

		// Localize post types for the triggers dropdown.
		$post_types = get_post_types( array( 'public' => true ), 'objects' );
		$types_list = array();
		foreach ( $post_types as $pt ) {
			$types_list[] = array(
				'value' => $pt->name,
				'label' => $pt->labels->singular_name,
			);
		}

		wp_localize_script( 'wpsignal-settings', 'wpsignalSettings', array(
			'connectUrl'    => rest_url( 'wpsignal/v1/connect' ),
			'oauthStartUrl' => wp_nonce_url(
				admin_url( 'admin-post.php?action=wpsignal_oauth_start' ),
				'wpsignal_oauth_start'
			),
			'restUrl'       => rest_url( 'wpsignal/v1/' ),
			'nonce'         => wp_create_nonce( 'wp_rest' ),
			'postTypes'     => $types_list,
			'baseUrl'       => $this->config->base_url(),
			'apiKey'        => $this->config->api_key(),
			'siteKey'       => $this->config->site_key(),
		) );

		echo '<div class="wrap">';
		echo '<h1>' . esc_html( get_admin_page_title() ) . '</h1>';
		echo '<div class="card" style="max-width:100%;" id="wpsignal-settings-root"></div>';
		echo '</div>';
	}

}
