<?php
/**
 * WPSignal\Triggers_REST: REST API for managing custom triggers.
 *
 * Provides GET and POST endpoints for reading and writing the
 * wpsignal_custom_triggers option. The POST endpoint replaces the
 * entire array (sanitized) on each save.
 *
 * @package WPSignal
 */

namespace WPSignal;

use WP_REST_Request, WP_REST_Response;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Triggers_REST {

	/** @var string wp_options key for saved trigger configs. */
	const OPTION_KEY = 'wpsignal_custom_triggers';

	/**
	 * Register REST routes.
	 *
	 * Hooked to `rest_api_init` during WPS::boot().
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route( 'wpsignal/v1', '/triggers', array(
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'get_triggers' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			),
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'save_triggers' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			),
		) );
	}

	/**
	 * Return saved trigger configs.
	 *
	 * @param WP_REST_Request $request The incoming request.
	 * @return WP_REST_Response
	 */
	public function get_triggers( WP_REST_Request $request ) {
		$triggers = get_option( self::OPTION_KEY, array() );

		return rest_ensure_response( array( 'triggers' => $triggers ) );
	}

	/**
	 * Save trigger configs (replaces entire array).
	 *
	 * @param WP_REST_Request $request The incoming request.
	 * @return WP_REST_Response
	 */
	public function save_triggers( WP_REST_Request $request ) {
		$raw = $request->get_param( 'triggers' );

		if ( ! is_array( $raw ) ) {
			$raw = array();
		}

		$sanitized = array();

		foreach ( $raw as $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}

			$type = isset( $item['type'] ) ? sanitize_key( $item['type'] ) : '';

			if ( ! in_array( $type, array( 'post_type', 'option' ), true ) ) {
				continue;
			}

			$row = array(
				'type'        => $type,
				'post_type'   => isset( $item['post_type'] ) ? sanitize_key( $item['post_type'] ) : '',
				'option_name' => isset( $item['option_name'] ) ? sanitize_key( $item['option_name'] ) : '',
				'channel'     => isset( $item['channel'] ) ? sanitize_text_field( $item['channel'] ) : 'events',
				'event'       => isset( $item['event'] ) ? sanitize_text_field( $item['event'] ) : '',
			);

			// Require a meaningful target.
			if ( 'post_type' === $type && empty( $row['post_type'] ) ) {
				continue;
			}
			if ( 'option' === $type && empty( $row['option_name'] ) ) {
				continue;
			}

			if ( empty( $row['event'] ) ) {
				continue;
			}

			$sanitized[] = $row;
		}

		update_option( self::OPTION_KEY, $sanitized );

		return rest_ensure_response( array(
			'triggers' => $sanitized,
			'message'  => __( 'Triggers saved.', 'eventra-for-wpsignal' ),
		) );
	}
}
