<?php
/**
 * WPSignal\Trigger - fluent builder for registering custom event triggers.
 *
 * Each trigger maps a WordPress action hook to a WordSocket event. When the
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
 * @package WordSocket
 */

namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Trigger builder.
 *
 * @since 0.7.0
 */
class Trigger {

	/**
	 * Event name (e.g. "post.updated"). Sent as the event field in the publish payload.
	 *
	 * @var string
	 */
	private $event;

	/**
	 * WordPress action hook name (e.g. "save_post").
	 *
	 * @var string
	 */
	private $hook;

	/**
	 * Hook priority. Default 10.
	 *
	 * @var int
	 */
	private $priority = 10;

	/**
	 * Number of arguments the hook callback accepts. Default 1.
	 *
	 * @var int
	 */
	private $accepted_args = 1;

	/**
	 * Channel name to publish on, or a callable resolving it from the hook arguments. Default "events".
	 *
	 * @var string|callable
	 */
	private $channel_name = 'events';

	/**
	 * Label a callable channel is listed under.
	 *
	 * @var string
	 */
	private $channel_label = '';

	/**
	 * Callback that builds the event data payload.
	 *
	 * @var callable|null
	 */
	private $data_callback;

	/**
	 * Callback that returns false to skip publishing.
	 *
	 * @var callable|null
	 */
	private $when_callback;

	/**
	 * Create a new trigger builder.
	 *
	 * Typically called via WPS::trigger() rather than directly.
	 *
	 * @since 0.7.0
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
	 *
	 * @since 0.7.0
	 *
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
	 *     ->channel( fn( $post_id, $post ) => 'blog:' . $post->post_parent, 'blog:{id}' )
	 * ```
	 *
	 * @since 0.7.0
	 * @since 0.32.0 Accepts a callable receiving the hook arguments, with a label for the Triggers tab.
	 *
	 * @param string|callable $channel Channel name, or a callable returning one from the hook arguments.
	 * @param string          $label   Optional. How a callable channel is listed. Default the event name.
	 * @return $this
	 */
	public function channel( $channel, $label = '' ) {
		$this->channel_name  = $channel;
		$this->channel_label = $label;
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
	 *
	 * @since 0.7.0
	 *
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
	 *
	 * @since 0.7.0
	 *
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
	 * @since 0.7.0
	 *
	 * @return void
	 */
	public function register() {
		WPS::instance()
			->trigger_registry()
			->add( $this );
	}

	/**
	 * Get the event name.
	 *
	 * @since 0.7.0
	 *
	 * @return string Event name (e.g. "post.updated").
	 */
	public function get_event() {
		return $this->event;
	}

	/**
	 * Get the WordPress hook name.
	 *
	 * @since 0.7.0
	 *
	 * @return string|null Hook name, or null if not set.
	 */
	public function get_hook() {
		return $this->hook;
	}

	/**
	 * Get the hook priority.
	 *
	 * @since 0.7.0
	 *
	 * @return int Priority (default 10).
	 */
	public function get_priority() {
		return $this->priority;
	}

	/**
	 * Get the number of accepted hook arguments.
	 *
	 * @since 0.7.0
	 *
	 * @return int Accepted args count (default 1).
	 */
	public function get_accepted_args() {
		return $this->accepted_args;
	}

	/**
	 * Get the channel name, resolving a callable channel from the hook arguments.
	 *
	 * @since 0.7.0
	 * @since 0.32.0 Takes the hook arguments for a callable channel, whose result must be a channel name of the site's own.
	 *
	 * @param array $args Hook arguments passed by WordPress.
	 * @return string Channel name (default "events").
	 */
	public function get_channel( array $args ) {
		if ( ! $this->has_dynamic_channel() ) {
			return $this->channel_name;
		}
		$channel = call_user_func_array( $this->channel_name, $args );
		return self::is_channel_name( $channel ) ? $channel : 'events';
	}

	/**
	 * Whether a value is a channel name a site may publish on: a short string of word characters, dots, colons and dashes under no reserved namespace.
	 *
	 * @since 0.32.0
	 *
	 * @param mixed $channel The value.
	 * @return bool
	 */
	public static function is_channel_name( $channel ): bool {
		if ( ! is_string( $channel ) || ! preg_match( '/^[A-Za-z0-9_.:-]{1,200}$/', $channel ) ) {
			return false;
		}
		$first = strtolower( strtok( $channel, ':' ) );
		return 'tenant' !== $first && 'wps' !== $first;
	}

	/**
	 * Whether the channel is a callable rather than a name.
	 *
	 * @since 0.32.0
	 *
	 * @return bool
	 */
	public function has_dynamic_channel() {
		return ! is_string( $this->channel_name ) && is_callable( $this->channel_name );
	}

	/**
	 * Get the channel as the Triggers tab lists it: the name, or a callable channel's label.
	 *
	 * @since 0.32.0
	 *
	 * @return string
	 */
	public function get_channel_label() {
		if ( ! $this->has_dynamic_channel() ) {
			return $this->channel_name;
		}
		return '' !== $this->channel_label ? $this->channel_label : $this->event;
	}

	/**
	 * Check whether this trigger has a condition callback.
	 *
	 * @since 0.7.0
	 *
	 * @return bool True if a when() callback is set.
	 */
	public function has_condition() {
		return null !== $this->when_callback;
	}

	/**
	 * Evaluate the condition callback against the hook arguments.
	 *
	 * @since 0.7.0
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
	 * @since 0.7.0
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
