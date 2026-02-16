<?php
/**
 * WPSignal\Admin_Page - WordPress admin settings page and menu registration.
 *
 * Registers a top-level "WPSignal" admin menu with two subpages:
 *   - Settings — server URL, API key, connection status, "Connect to WPSignal" button.
 *   - Kitchen Sink — interactive demo page (delegated to Kitchen_Sink_Page).
 *
 * The settings page uses the WordPress Settings API (register_setting,
 * add_settings_section, add_settings_field). The "Connect to WPSignal"
 * button calls the REST endpoint POST /wpsignal/v1/connect via fetch.
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

	/** @var Kitchen_Sink_Page Kitchen Sink subpage handler. */
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
		add_action( 'admin_init', array( $this, 'register_settings' ) );
	}

	/**
	 * Register the top-level WPSignal menu and subpages.
	 *
	 * Creates:
	 *   - WPSignal (top-level, dashicons-rss)
	 *     - Settings (default subpage)
	 *     - Kitchen Sink
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
			__( 'Kitchen Sink', 'wpsignal' ),
			__( 'Kitchen Sink', 'wpsignal' ),
			'manage_options',
			'wpsignal-kitchen-sink',
			array( $this->kitchen_sink, 'render_page' )
		);
	}

	/**
	 * Register settings fields with the WordPress Settings API.
	 *
	 * Registers four options (wpsignal_base_url, wpsignal_api_key,
	 * wpsignal_site_key, wpsignal_site_secret) and renders them in the
	 * "Connection Settings" section.
	 *
	 * @return void
	 */
	public function register_settings() {
		register_setting( 'wpsignal_settings', 'wpsignal_base_url', array(
			'type'              => 'string',
			'sanitize_callback' => 'esc_url_raw',
			'default'           => '',
		) );

		register_setting( 'wpsignal_settings', 'wpsignal_api_key', array(
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
			'default'           => '',
		) );

		register_setting( 'wpsignal_settings', 'wpsignal_site_key', array(
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
			'default'           => '',
		) );

		register_setting( 'wpsignal_settings', 'wpsignal_site_secret', array(
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
			'default'           => '',
		) );

		add_settings_section(
			'wpsignal_main',
			__( 'Connection Settings', 'wpsignal' ),
			'__return_null',
			'wpsignal'
		);

		add_settings_field( 'wpsignal_base_url', __( 'Server URL', 'wpsignal' ), array( $this, 'field_base_url' ), 'wpsignal', 'wpsignal_main' );
		add_settings_field( 'wpsignal_api_key', __( 'API Key', 'wpsignal' ), array( $this, 'field_api_key' ), 'wpsignal', 'wpsignal_main' );
		add_settings_field( 'wpsignal_connection_status', __( 'Status', 'wpsignal' ), array( $this, 'field_connection_status' ), 'wpsignal', 'wpsignal_main' );
	}

	/**
	 * Render the Server URL input field.
	 *
	 * @return void
	 */
	public function field_base_url() {
		$value = $this->config->base_url();
		printf(
			'<input type="url" name="wpsignal_base_url" value="%s" class="regular-text" placeholder="https://api.wpsignal.io" />',
			esc_attr( $value )
		);
		echo '<p class="description">' . esc_html__( 'The wpsignal.io service URL.', 'wpsignal' ) . '</p>';
	}

	/**
	 * Render the API Key input field.
	 *
	 * @return void
	 */
	public function field_api_key() {
		$value = $this->config->api_key();
		printf(
			'<input type="password" name="wpsignal_api_key" value="%s" class="regular-text" />',
			esc_attr( $value )
		);
		echo '<p class="description">' . esc_html__( 'Get your API key from your wpsignal.io dashboard.', 'wpsignal' ) . '</p>';
	}

	/**
	 * Render the connection status indicator.
	 *
	 * Shows a green checkmark + site key when connected, or a red X when not.
	 *
	 * @return void
	 */
	public function field_connection_status() {
		$site_key = $this->config->site_key();

		if ( ! empty( $site_key ) ) {
			echo '<span style="color:#46b450;">&#10003; Connected</span>';
			echo '<br /><code>' . esc_html( $site_key ) . '</code>';
		} else {
			echo '<span style="color:#dc3232;">&#10005; Not connected</span>';
		}
	}

	/**
	 * Render the full settings page.
	 *
	 * Enqueues admin.js (vanilla JS, no jQuery), localizes the REST connect
	 * URL and nonce, then outputs the settings form and "Connect to WPSignal"
	 * button.
	 *
	 * @return void
	 */
	public function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		wp_enqueue_script(
			'wpsignal-admin',
			URL . 'assets/admin.js',
			array(),
			VERSION,
			true
		);
		wp_localize_script( 'wpsignal-admin', 'wpSignalAdmin', array(
			'connectUrl' => rest_url( 'wpsignal/v1/connect' ),
			'nonce'      => wp_create_nonce( 'wp_rest' ),
		) );

		?>
		<div class="wrap">
			<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>

			<form action="options.php" method="post">
				<?php
				settings_fields( 'wpsignal_settings' );
				do_settings_sections( 'wpsignal' );
				submit_button();
				?>
			</form>

			<hr />

			<h2><?php esc_html_e( 'Quick Connect', 'wpsignal' ); ?></h2>
			<p><?php esc_html_e( 'Save your Server URL and API Key above, then click the button below to automatically register this site.', 'wpsignal' ); ?></p>
			<button type="button" id="wpsignal-connect-btn" class="button button-primary">
				<?php esc_html_e( 'Connect to WPSignal', 'wpsignal' ); ?>
			</button>
			<span id="wpsignal-connect-status" style="margin-left:10px;"></span>
		</div>
		<?php
	}

}
