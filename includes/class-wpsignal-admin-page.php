<?php
/**
 * WPSignal\Admin_Page - WordPress admin settings page and menu registration.
 *
 * @package WordSocket
 */

namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin page for the WordSocket plugin.
 */
class Admin_Page {

	/**
	 * Configuration accessor.
	 *
	 * @var Config
	 */
	private $config;

	/**
	 * Constructor.
	 *
	 * @param Config $config Configuration accessor.
	 * @return void
	 */
	public function __construct( Config $config ) {
		$this->config = $config;
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

	}

	/**
	 * Menu icon for the top-level WordSocket item. Fill using `#f3f1f1` this is the font color used for
	 * default dashicons.
	 *
	 * @return string
	 */
	private function get_menu_icon() {
		$svg = '<svg width="800" height="800" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#f3f1f1" d="M18 7a7.67 7.67 0 0 0-6 3.19A7.67 7.67 0 0 0 6 7c-3.687 0-5 2.583-5 5 0 3.687 2.583 5 5 5a7.67 7.67 0 0 0 6-3.19A7.67 7.67 0 0 0 18 17c2.417 0 5-1.313 5-5 0-2.417-1.313-5-5-5M6 15a2.69 2.69 0 0 1-3-3 2.69 2.69 0 0 1 3-3c2.579 0 4.225 2.065 4.837 3-.612.935-2.258 3-4.837 3m12 0c-2.579 0-4.225-2.065-4.837-3 .612-.935 2.258-3 4.837-3a2.69 2.69 0 0 1 3 3 2.69 2.69 0 0 1-3 3"/></svg>';
		return 'data:image/svg+xml;base64,' . base64_encode( $svg );
	}

	/**
	 * Render the Settings page: mounts the React settings app.
	 *
	 * @return void
	 */
	public function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$asset_file = DIR . 'build/settings.asset.php';
		$asset      = file_exists( $asset_file ) ? require $asset_file : array(
			'dependencies' => array(),
			'version'      => VERSION,
		);

		wp_enqueue_script(
			'wpsignal-settings',
			URL . 'build/settings.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_set_script_translations( 'wpsignal-settings', 'wordsocket', DIR . 'languages' );

		wp_enqueue_style(
			'wpsignal-settings',
			URL . 'build/settings.css',
			[],
			$asset['version']
		);

		wp_style_add_data( 'wpsignal-settings', 'rtl', 'replace' );

		// Localize post types for the triggers dropdown.
		$post_types = get_post_types( array( 'public' => true ), 'objects' );
		$types_list = array();
		foreach ( $post_types as $pt ) {
			$types_list[] = array(
				'value' => $pt->name,
				'label' => $pt->labels->singular_name,
			);
		}

		$triggers = array_map(
			function ( $trigger ) {
				return array(
					'event'     => $trigger->get_event(),
					'hook'      => $trigger->get_hook(),
					'priority'  => $trigger->get_priority(),
					'args'      => $trigger->get_accepted_args(),
					'channel'   => $trigger->get_channel(),
					'condition' => $trigger->has_condition(),
				);
			},
			WPS::instance()->trigger_registry()->all()
		);

		wp_localize_script(
			'wpsignal-settings',
			'wpsignalSettings',
			array(
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
				'triggers'      => $triggers,
			)
		);

		wp_add_inline_script(
			'wpsignal-settings',
			'window.wpSignalConfig = window.wpSignalConfig || ' . wp_json_encode( array( 'isSsl' => is_ssl() ) ) . ';',
			'before'
		);

		echo '<div class="wrap">';
		echo '<header class="wpsignal-header">';
		echo '<h1>' . esc_html( get_admin_page_title() ) . '</h1>';
		$new_tab_hint = '<span class="screen-reader-text"> ' . esc_html__( '(opens in a new tab)', 'wordsocket' ) . '</span>';
		echo '<nav class="wpsignal-meta-nav" aria-label="' . esc_attr__( 'External links', 'wordsocket' ) . '">';
		echo '<a href="https://api.wpsignal.io/dashboard?utm_source=wordpress&utm_medium=plugin&utm_campaign=settings-page" target="_blank" rel="noopener noreferrer">' . esc_html__( 'Dashboard', 'wordsocket' ) . $new_tab_hint . '</a>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		echo '<span aria-hidden="true"> / </span>';
		echo '<a href="https://wpsignal.io/docs/getting-started/?utm_source=wordpress&utm_medium=plugin&utm_campaign=settings-page" target="_blank" rel="noopener noreferrer">' . esc_html__( 'Documentation', 'wordsocket' ) . $new_tab_hint . '</a>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		echo '<span aria-hidden="true"> / </span>';
		echo '<a href="https://wordpress.org/support/plugin/wordsocket/" target="_blank" rel="noopener noreferrer">' . esc_html__( 'Support', 'wordsocket' ) . $new_tab_hint . '</a>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		echo '<span aria-hidden="true"> / </span>';
		echo '<a href="https://docs.google.com/forms/d/e/1FAIpQLSeebdF0SjbhnCm6UhlVeXv5CtCA_NJgSf4nyb3rxOFIU32xYw/viewform?usp=publish-editor" target="_blank" rel="noopener noreferrer">' . esc_html__( 'Feedback', 'wordsocket' ) . $new_tab_hint . '</a>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		echo '<span aria-hidden="true"> / </span>';
		echo '<a class="wpsignal-logo" href="https://wpsignal.io/?utm_source=wordpress&utm_medium=plugin&utm_campaign=settings-page" target="_blank" rel="noopener noreferrer" aria-label="' . esc_attr__( 'WPSignal home (opens in a new tab)', 'wordsocket' ) . '">';
		echo '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 443.21 252" aria-hidden="true" focusable="false">';
		echo '<g>';
		echo '<path fill="currentColor" d="M357.24,189c3.09,3.09,7.14,4.64,11.2,4.64s8.11-1.55,11.2-4.64c6.18-6.19,6.18-16.21,0-22.4l-63.95-63.95c-16.22-16.22-16.22-42.61,0-58.83,16.21-16.22,42.61-16.22,58.83,0l31.67,31.67c6.19,6.19,16.21,6.19,22.4,0,6.19-6.18,6.19-16.21,0-22.4l-31.67-31.67c-28.57-28.57-75.06-28.57-103.62,0-28.57,28.57-28.57,75.05,0,103.62l63.95,63.95Z"/>';
		echo '<path fill="currentColor" d="M421.75,126.91l-63.95-63.95c-6.19-6.18-16.21-6.18-22.4,0-6.18,6.19-6.18,16.21,0,22.4l63.95,63.95c16.22,16.22,16.22,42.61,0,58.83-16.21,16.22-42.61,16.22-58.83,0l-28.97-28.97h0l-113.52-113.52c-4.53-4.53-11.34-5.88-17.26-3.43-5.92,2.45-9.78,8.23-9.78,14.63v104.25L0,10.1c.12,13.95.13,27.91.13,41.86v3.06l175.51,175.51c.11.11.22.2.33.3.27.25.54.51.82.74.21.17.43.33.65.49.2.15.39.3.59.44.24.16.49.3.74.45.2.12.39.24.59.35.24.13.5.24.75.36.22.1.44.21.66.31.24.1.48.18.73.27s.48.18.73.26c.24.07.49.13.73.19.26.06.51.14.77.19.28.06.56.09.84.13.23.03.46.08.69.1.52.05,1.04.08,1.56.08s1.04-.03,1.56-.08c.23-.02.46-.07.69-.1.28-.04.56-.07.84-.13.26-.05.51-.12.76-.19.25-.06.5-.12.74-.19.25-.07.49-.17.73-.25.25-.09.49-.17.74-.27.22-.09.43-.2.65-.3.25-.12.51-.23.76-.36.2-.11.39-.23.58-.35.25-.15.5-.29.74-.45.2-.13.39-.29.58-.43.22-.16.45-.32.66-.49.29-.24.56-.49.83-.75.1-.1.22-.19.32-.29.1-.1.19-.21.29-.32.26-.27.51-.54.75-.83.18-.22.34-.45.5-.67.14-.19.29-.38.42-.57.17-.25.31-.51.46-.76.11-.19.23-.37.34-.57.14-.25.25-.51.37-.77.1-.21.2-.42.29-.63.1-.25.19-.51.28-.77.08-.23.17-.46.24-.69.08-.26.14-.53.2-.79.06-.24.13-.47.17-.71.06-.31.1-.63.14-.94.03-.2.07-.39.09-.59.05-.53.08-1.06.08-1.58v-104.24l83.78,83.78s0,0,0,0l1.07,1.07,1.63,1.63s0,0,0,0l28.97,28.96c13.84,13.84,32.24,21.46,51.81,21.46,19.57,0,37.97-7.62,51.81-21.46,13.84-13.84,21.46-32.24,21.46-51.81s-7.62-37.97-21.46-51.81Z"/>';
		echo '</g>';
		echo '</svg>';
		echo '</a>';
		echo '</nav>';
		echo '</header>';
		echo '<div class="card" style="max-width:100%;" id="wpsignal-settings-root">';
		$this->render_skeleton();
		echo '</div>';
	}

	/**
	 * Server-side skeleton for the settings page.
	 *
	 * This is used to show a loading state while the React app is loading.
	 *
	 * @return void
	 */
	private function render_skeleton() {
		echo '<div class="wpsignal-skeleton">';
		echo '<div class="wpsignal-skeleton__tabs">';
		echo '</div>';
		echo '<div class="wpsignal-skeleton__tab wpsignal-skeleton__shimmer"></div>';
		echo '<div class="wpsignal-skeleton__tab wpsignal-skeleton__shimmer"></div>';
		echo '<div class="wpsignal-skeleton__tab wpsignal-skeleton__shimmer"></div>';
		echo '<div class="wpsignal-skeleton__tab wpsignal-skeleton__shimmer"></div>';
		echo '</div>';
		echo '<div class="wpsignal-skeleton__body">';
		echo '<div class="wpsignal-skeleton__notice wpsignal-skeleton__shimmer"></div>';
		echo '<div class="wpsignal-skeleton__line wpsignal-skeleton__shimmer"></div>';
		echo '<div class="wpsignal-skeleton__button wpsignal-skeleton__shimmer"></div>';
		echo '<hr class="wpsignal-skeleton__divider">';
		echo '<div class="wpsignal-skeleton__toggle-row">';
		echo '<div class="wpsignal-skeleton__toggle wpsignal-skeleton__shimmer"></div>';
		echo '<div class="wpsignal-skeleton__toggle-label wpsignal-skeleton__shimmer"></div>';
		echo '</div>';
		echo '<div class="wpsignal-skeleton__sub-line wpsignal-skeleton__shimmer"></div>';
		echo '</div>';
		echo '</div>';
	}
}
