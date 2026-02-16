<?php
/**
 * WPSignal\Trigger_Registry - stores triggers and wires WordPress hooks.
 *
 * The registry is the glue between Trigger (builder) and WordPress
 * action hooks. When a trigger is added, the registry attaches an
 * `add_action()` callback that evaluates the trigger's condition, builds the
 * data payload, and publishes the event.
 *
 * Built-in triggers are registered via register_defaults(). Third-party
 * plugins add triggers via the builder pattern:
 *
 *     WPS::trigger( 'comment.created' )
 *         ->on( 'wp_insert_comment', 10, 2 )
 *         ->data( function ( $comment_id, $comment ) { ... } )
 *         ->register();  // calls $registry->add() internally
 *
 * Inspecting all registered triggers (used by the Kitchen Sink page):
 *
 *     $triggers = WPS::instance()->trigger_registry()->all();
 *     foreach ( $triggers as $trigger ) {
 *         echo $trigger->get_event() . ' → ' . $trigger->get_hook();
 *     }
 *
 * @package WPSignal
 */

 namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Trigger_Registry {

	/** @var Publisher Event publisher for dispatching events. */
	private $publisher;

	/** @var Trigger[] All registered triggers. */
	private $triggers = array();

	/**
	 * @param Publisher $publisher Event publisher instance.
	 */
	public function __construct( Publisher $publisher ) {
		$this->publisher = $publisher;
	}

	/**
	 * Add a trigger and wire its WordPress action hook.
	 *
	 * When the trigger's hook fires, this evaluates the condition callback
	 * (if any), builds the data payload, and publishes the event. If the
	 * trigger has no hook set (e.g. for manual-only triggers), it is stored
	 * but no action is wired.
	 *
	 * @param Trigger $trigger A configured trigger builder instance.
	 * @return void
	 */
	public function add( Trigger $trigger ) {
		$this->triggers[] = $trigger;

		$hook = $trigger->get_hook();
		if ( empty( $hook ) ) {
			return;
		}

		$publisher = $this->publisher;

		add_action(
			$hook,
			function () use ( $trigger, $publisher ) {
				$args = func_get_args();

				if ( ! $trigger->evaluate_condition( $args ) ) {
					return;
				}

				$data = $trigger->build_data( $args );

				$publisher->publish(
					$trigger->get_channel(),
					$trigger->get_event(),
					$data
				);
			},
			$trigger->get_priority(),
			$trigger->get_accepted_args()
		);
	}

	/**
	 * Register the built-in default triggers.
	 *
	 * Currently registers one trigger:
	 *   - post.updated: fires on save_post (priority 20, 3 args), publishes
	 *     to the "events" channel when a post is published (skips autosaves
	 *     and revisions).
	 *
	 * Called during WPSignal::boot().
	 *
	 * @return void
	 */
	public function register_defaults() {
		$trigger = new Trigger( 'post.updated' );
		$trigger
			->on( 'save_post', 20, 3 )
			->channel( 'events' )
			->data( function ( $post_id, $post, $update ) {
				return array(
					'post_id'    => $post_id,
					'post_type'  => $post->post_type,
					'post_title' => $post->post_title,
					'permalink'  => get_permalink( $post_id ),
					'excerpt'    => get_the_excerpt( $post ),
					'updated'    => $update,
				);
			} )
			->when( function ( $post_id, $post ) {
				if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
					return false;
				}
				if ( wp_is_post_revision( $post_id ) ) {
					return false;
				}
				return 'publish' === $post->post_status;
			} );

		$this->add( $trigger );
	}

	/**
	 * Return all registered triggers.
	 *
	 * Useful for inspection, debugging, and the Kitchen Sink triggers table.
	 *
	 * @return Trigger[] Array of all registered trigger instances.
	 */
	public function all() {
		return $this->triggers;
	}
}
