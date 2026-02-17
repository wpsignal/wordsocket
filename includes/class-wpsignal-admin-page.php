<?php
/**
 * WPSignal\Admin_Page - WordPress admin settings page and menu registration.
 *
 * Registers a top-level "WPSignal" admin menu with two subpages:
 *   - Settings — React SPA with Connection and Triggers tabs.
 *   - Monitor  — interactive debug/test page (delegated to Kitchen_Sink_Page).
 *
 * @package WPSignal
 */

 namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Admin_Page {

	/** @var Config Configuration accessor. */
	private $config;

	/** @var Kitchen_Sink_Page Kitchen Sink (Monitor) subpage handler. */
	private $kitchen_sink;

	/**
	 * @param Config $config Configuration accessor.
	 */
	public function __construct( Config $config ) {
		$this->config       = $config;
		$this->kitchen_sink = new Kitchen_Sink_Page( $config );
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
	 * Register the top-level WPSignal menu and subpages.
	 *
	 * Creates:
	 *   - WPSignal (top-level, dashicons-rss)
	 *     - Settings (React app: Connection + Triggers tabs)
	 *     - Monitor  (renamed from Kitchen Sink)
	 *
	 * @return void
	 */
	public function register_menu() {
		add_menu_page(
			__( 'WPSignal', 'wpsignal' ),
			__( 'WPSignal', 'wpsignal' ),
			'manage_options',
			'wpsignal',
			array( $this, 'render_settings_page' ),
			'dashicons-rss',
			80
		);

		add_submenu_page(
			'wpsignal',
			__( 'Settings', 'wpsignal' ),
			__( 'Settings', 'wpsignal' ),
			'manage_options',
			'wpsignal',
			array( $this, 'render_settings_page' )
		);

		add_submenu_page(
			'wpsignal',
			__( 'Monitor', 'wpsignal' ),
			__( 'Monitor', 'wpsignal' ),
			'manage_options',
			'wpsignal-kitchen-sink',
			array( $this->kitchen_sink, 'render_page' )
		);
	}

	/**
	 * Render the Settings page — mounts the React app.
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
			'connectUrl' => rest_url( 'wpsignal/v1/connect' ),
			'restUrl'    => rest_url( 'wpsignal/v1/' ),
			'nonce'      => wp_create_nonce( 'wp_rest' ),
			'postTypes'  => $types_list,
			'baseUrl'    => $this->config->base_url(),
			'apiKey'     => $this->config->api_key(),
			'siteKey'    => $this->config->site_key(),
		) );

		echo '<div class="wrap">';
		echo '<h1>' . esc_html( get_admin_page_title() ) . '</h1>';
		echo '<div id="wpsignal-settings-root"></div>';
		echo '</div>';
	}

}
