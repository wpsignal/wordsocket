<?php
/**
 * WPSignal\Trigger - fluent builder for registering custom event triggers.
 *
 * Each trigger maps a WordPress action hook to a WPSignal event. When the
 * hook fires, the trigger evaluates an optional condition, builds a data
 * payload, and publishes the event to the server.
 *
 * Usage: register a trigger in your theme or plugin:
 *
 *     // In functions.php or on the 'init' / 'wpsignal_loaded' action:
 *     WPS::trigger( 'post.updated' )
 *         ->on( 'save_post', 20, 3 )
 *         ->channel( 'events' )
 *         ->data( function ( $post_id, $post, $update ) {
 *             return [
 *                 'post_id'    => $post_id,
 *                 'post_type'  => $post->post_type,
 *                 'post_title' => $post->post_title,
 *                 'permalink'  => get_permalink( $post_id ),
 *             ];
 *         } )
 *         ->when( function ( $post_id, $post ) {
 *             if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) return false;
 *             if ( wp_is_post_revision( $post_id ) ) return false;
 *             return 'publish' === $post->post_status;
 *         } )
 *         ->register();
 *
 * Usage: minimal trigger (no condition, default channel "events"):
 *
 *     WPS::trigger( 'user.login' )
 *         ->on( 'wp_login', 10, 2 )
 *         ->data( function ( $user_login, $user ) {
 *             return [ 'user_id' => $user->ID, 'login' => $user_login ];
 *         } )
 *         ->register();
 *
 * Usage: cross-plugin trigger with custom channel:
 *
 *     WPS::trigger( 'order.completed' )
 *         ->on( 'woocommerce_order_status_completed' )
 *         ->channel( 'orders' )
 *         ->data( function ( $order_id ) {
 *             $order = wc_get_order( $order_id );
 *             return [ 'order_id' => $order_id, 'total' => $order->get_total() ];
 *         } )
 *         ->register();
 *
 * @package WPSignal
 */

 namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Trigger {

	/** @var string Event name (e.g. "post.updated"). Sent as the event field in the publish payload. */
	private $event;

	/** @var string WordPress action hook name (e.g. "save_post"). */
	private $hook;

	/** @var int Hook priority. Default 10. */
	private $priority = 10;

	/** @var int Number of arguments the hook callback accepts. Default 1. */
	private $accepted_args = 1;

	/** @var string Channel name to publish on. Default "events". */
	private $channel_name = 'events';

	/** @var callable|null Callback that builds the event data payload. */
	private $data_callback;

	/** @var callable|null Callback that returns false to skip publishing. */
	private $when_callback;

	/**
	 * Create a new trigger builder.
	 *
	 * Typically called via WPS::trigger() rather than directly.
	 *
	 * @param string $event Event name (e.g. "post.updated", "comment.created").
	 */
	public function __construct( $event ) {
		$this->event = $event;
	}

	/**
	 * Set the WordPress action hook to listen on.
	 *
	 * @usage: set the WordPress action hook to listen on:
	 * ```php
	 *     ->on( 'save_post', 20, 3 )    // priority 20, 3 args
	 *     ->on( 'wp_login' )            // defaults: priority 10, 1 arg
	 * ```
	 * @param string $hook          WordPress action hook name.
	 * @param int    $priority      Optional. Hook priority. Default 10.
	 * @param int    $accepted_args Optional. Number of hook arguments. Default 1.
	 * @return $this
	 */
	public function on( $hook, $priority = 10, $accepted_args = 1 ) {
		$this->hook          = $hook;
		$this->priority      = $priority;
		$this->accepted_args = $accepted_args;
		return $this;
	}

	/**
	 * Set the channel to publish on.
	 *
	 * Defaults to "events" if not called. The server normalizes this to
	 * the full tenant-scoped channel name.
	 *
	 * @usage: set the channel to publish on:
	 * ```php
	 *     ->channel( 'orders' )
	 * ```
	 * @param string $channel Channel name.
	 * @return $this
	 */
	public function channel( $channel ) {
		$this->channel_name = $channel;
		return $this;
	}

	/**
	 * Set the data builder callback.
	 *
	 * The callback receives the same arguments as the WordPress hook and
	 * should return an associative array. This array becomes the `data`
	 * field in the published event payload.
	 *
	 * @usage: set the data builder callback:
	 * ```php
	 *     ->data( function ( $post_id, $post, $update ) {
	 *         return [
	 *             'post_id'    => $post_id,
	 *             'post_title' => $post->post_title,
	 *         ];
	 *     } )
	 * ```
	 * @param callable $callback Data builder. Receives hook args, returns array.
	 * @return $this
	 */
	public function data( callable $callback ) {
		$this->data_callback = $callback;
		return $this;
	}

	/**
	 * Set a condition callback.
	 *
	 * The callback receives the same arguments as the WordPress hook.
	 * Return false to skip publishing for this hook invocation.
	 * If not set, the trigger always fires.
	 *
	 * @usage: set the condition callback:
	 * ```php
	 *     ->when( function ( $post_id, $post ) {
	 *         return 'publish' === $post->post_status;
	 *     } )
	 * ```
	 * @param callable $callback Condition check. Receives hook args, returns bool.
	 * @return $this
	 */
	public function when( callable $callback ) {
		$this->when_callback = $callback;
		return $this;
	}

	/**
	 * Register this trigger with the global trigger registry.
	 *
	 * This wires the WordPress hook so the trigger fires automatically.
	 * Must be called after configuring the builder.
	 *
	 * @usage: register the trigger:
	 * ```php
	 *     WPS::trigger( 'post.updated' )
	 *         ->on( 'save_post', 20, 3 )
	 *         ->channel( 'events' )
	 *         ->data( function ( $post_id, $post, $update ) {
	 *             return array(
	 *                 'post_id'    => $post_id,
	 *                 'post_type'  => $post->post_type,
	 *     ->register();
	 * ```
	 * @return void
	 */
	public function register() {
		WPS::instance()->trigger_registry()->add( $this );
	}

	// -- Accessors (used by Trigger_Registry) ----------------------

	/**
	 * Get the event name.
	 *
	 * @return string Event name (e.g. "post.updated").
	 */
	public function get_event() {
		return $this->event;
	}

	/**
	 * Get the WordPress hook name.
	 *
	 * @return string|null Hook name, or null if not set.
	 */
	public function get_hook() {
		return $this->hook;
	}

	/**
	 * Get the hook priority.
	 *
	 * @return int Priority (default 10).
	 */
	public function get_priority() {
		return $this->priority;
	}

	/**
	 * Get the number of accepted hook arguments.
	 *
	 * @return int Accepted args count (default 1).
	 */
	public function get_accepted_args() {
		return $this->accepted_args;
	}

	/**
	 * Get the channel name.
	 *
	 * @return string Channel name (default "events").
	 */
	public function get_channel() {
		return $this->channel_name;
	}

	/**
	 * Check whether this trigger has a condition callback.
	 *
	 * @return bool True if a when() callback is set.
	 */
	public function has_condition() {
		return null !== $this->when_callback;
	}

	/**
	 * Evaluate the condition callback against the hook arguments.
	 *
	 * Returns true if no condition is set (trigger always fires).
	 *
	 * @param array $args Hook arguments passed by WordPress.
	 * @return bool True if the trigger should fire, false to skip.
	 */
	public function evaluate_condition( array $args ) {
		if ( null === $this->when_callback ) {
			return true;
		}
		return (bool) call_user_func_array( $this->when_callback, $args );
	}

	/**
	 * Build the event data payload from the hook arguments.
	 *
	 * Returns an empty array if no data callback is set.
	 *
	 * @param array $args Hook arguments passed by WordPress.
	 * @return array Data payload to include in the published event.
	 */
	public function build_data( array $args ) {
		if ( null === $this->data_callback ) {
			return array();
		}
		return (array) call_user_func_array( $this->data_callback, $args );
	}
}
