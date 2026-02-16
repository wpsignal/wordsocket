<?php
/**
 * WPSignal\Custom_Triggers — hydrates saved trigger configs into the registry.
 *
 * Reads the wpsignal_custom_triggers option (saved by the Triggers UI) and
 * creates Trigger objects with appropriate hooks, conditions, and data
 * callbacks. These are then added to the Trigger_Registry so they fire
 * like any other registered trigger.
 *
 * Two trigger types are supported:
 *   - post_type: hooks transition_post_status, fires on publish/update
 *   - option:    hooks update_option_{name}, fires on any change
 *
 * @package WPSignal
 */

namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Custom_Triggers {

	/** @var Trigger_Registry */
	private $registry;

	/**
	 * @param Trigger_Registry $registry The trigger registry to add triggers to.
	 */
	public function __construct( Trigger_Registry $registry ) {
		$this->registry = $registry;
	}

	/**
	 * Load saved configs from wp_options and register them.
	 *
	 * @return void
	 */
	public function register_saved() {
		$configs = get_option( Triggers_REST::OPTION_KEY, array() );

		if ( ! is_array( $configs ) || empty( $configs ) ) {
			return;
		}

		foreach ( $configs as $config ) {
			if ( ! is_array( $config ) || empty( $config['type'] ) ) {
				continue;
			}

			switch ( $config['type'] ) {
				case 'post_type':
					$this->register_post_type_trigger( $config );
					break;
				case 'option':
					$this->register_option_trigger( $config );
					break;
			}
		}
	}

	/**
	 * Register a post-type trigger.
	 *
	 * Hooks transition_post_status and fires when a post of the configured
	 * type transitions to 'publish'.
	 *
	 * @param array $config Trigger config from wp_options.
	 * @return void
	 */
	private function register_post_type_trigger( array $config ) {
		$post_type = $config['post_type'];
		$channel   = ! empty( $config['channel'] ) ? $config['channel'] : 'events';
		$event     = ! empty( $config['event'] ) ? $config['event'] : $post_type . '.updated';

		$trigger = new Trigger( $event );
		$trigger
			->on( 'transition_post_status', 10, 3 )
			->channel( $channel )
			->data( function ( $new_status, $old_status, $post ) {
				return array(
					'post_id'    => $post->ID,
					'post_type'  => $post->post_type,
					'post_title' => $post->post_title,
					'permalink'  => get_permalink( $post->ID ),
					'old_status' => $old_status,
					'new_status' => $new_status,
				);
			} )
			->when( function ( $new_status, $old_status, $post ) use ( $post_type ) {
				if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
					return false;
				}
				if ( wp_is_post_revision( $post->ID ) ) {
					return false;
				}
				if ( $post->post_type !== $post_type ) {
					return false;
				}
				return 'publish' === $new_status;
			} );

		$this->registry->add( $trigger );
	}

	/**
	 * Register an option trigger.
	 *
	 * Hooks update_option_{option_name} and fires whenever the option changes.
	 *
	 * @param array $config Trigger config from wp_options.
	 * @return void
	 */
	private function register_option_trigger( array $config ) {
		$option_name = $config['option_name'];
		$channel     = ! empty( $config['channel'] ) ? $config['channel'] : 'events';
		$event       = ! empty( $config['event'] ) ? $config['event'] : 'option.' . $option_name . '.updated';

		$trigger = new Trigger( $event );
		$trigger
			->on( 'update_option_' . $option_name, 10, 3 )
			->channel( $channel )
			->data( function ( $old_value, $value, $option ) {
				return array(
					'option'    => $option,
					'old_value' => $old_value,
					'new_value' => $value,
				);
			} );

		$this->registry->add( $trigger );
	}
}
