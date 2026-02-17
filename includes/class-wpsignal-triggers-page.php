<?php
/**
 * WPSignal\Triggers_Page — admin submenu page for managing custom triggers.
 *
 * Registers a "Triggers" submenu under WPSignal, renders the React mount
 * point, and enqueues the @wordpress/scripts-built bundle.
 *
 * @package WPSignal
 */

namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Triggers_Page {

	/**
	 * Initialize admin hooks.
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_menu', array( $this, 'register_submenu' ) );
	}

	/**
	 * Register the Triggers submenu under WPSignal.
	 *
	 * @return void
	 */
	public function register_submenu() {
		add_submenu_page(
			'wpsignal',
			__( 'Triggers', 'wpsignal' ),
			__( 'Triggers', 'wpsignal' ),
			'manage_options',
			'wpsignal-triggers',
			array( $this, 'render_page' )
		);
	}

	/**
	 * Render the Triggers page and enqueue React assets.
	 *
	 * @return void
	 */
	public function render_page() {
		$asset_file = DIR . 'build/triggers.asset.php';

		if ( ! file_exists( $asset_file ) ) {
			echo '<div class="wrap"><h1>' . esc_html__( 'Triggers', 'wpsignal' ) . '</h1>';
			echo '<p>' . esc_html__( 'Build assets not found. Run npm run build.', 'wpsignal' ) . '</p></div>';
			return;
		}

		$asset = require $asset_file;

		wp_enqueue_script(
			'wpsignal-triggers',
			URL . 'build/triggers.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_enqueue_style(
			'wpsignal-triggers',
			URL . 'build/triggers.css',
			array( 'wp-components' ),
			$asset['version']
		);

		// Localize post types for the dropdown.
		$post_types = get_post_types( array( 'public' => true ), 'objects' );
		$types_list = array();
		foreach ( $post_types as $pt ) {
			$types_list[] = array(
				'value' => $pt->name,
				'label' => $pt->labels->singular_name,
			);
		}

		wp_localize_script( 'wpsignal-triggers', 'wpsignalTriggers', array(
			'postTypes' => $types_list,
			'restUrl'   => rest_url( 'wpsignal/v1/triggers' ),
			'nonce'     => wp_create_nonce( 'wp_rest' ),
		) );

		echo '<div class="wrap">';
		echo '<h1>' . esc_html__( 'WPSignal Triggers', 'wpsignal' ) . '</h1>';
		echo '<div id="wpsignal-triggers-root"></div>';
		echo '</div>';
	}
}
