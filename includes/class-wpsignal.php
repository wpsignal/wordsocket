<?php
/**
 * WPSignal — main singleton facade.
 *
 * Central entry point for the plugin. Provides static convenience methods for
 * the two most common operations (registering triggers and publishing events)
 * and wires all internal components during boot().
 *
 * Usage — register a custom trigger:
 *
 *     add_action( 'wpsignal_loaded', function () {
 *         WPSignal::trigger( 'comment.created' )
 *             ->on( 'wp_insert_comment', 10, 2 )
 *             ->data( function ( $comment_id, $comment ) {
 *                 return [
 *                     'comment_id' => $comment_id,
 *                     'post_id'    => $comment->comment_post_ID,
 *                     'author'     => $comment->comment_author,
 *                 ];
 *             } )
 *             ->when( function ( $comment_id, $comment ) {
 *                 return (int) $comment->comment_approved === 1;
 *             } )
 *             ->register();
 *     } );
 *
 * Usage — publish an event directly (no hook):
 *
 *     WPSignal::publish( 'events', 'custom.event', [ 'key' => 'value' ] );
 *
 * @package WPSignal
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class WPSignal {

	/** @var WPSignal|null Singleton instance. */
	private static $instance;

	/** @var WPSignal_Config Configuration accessor. */
	private $config_instance;

	/** @var WPSignal_Publisher Event publisher. */
	private $publisher_instance;

	/** @var WPSignal_Token JWT minting and REST route handler. */
	private $token_instance;

	/** @var WPSignal_Trigger_Registry Trigger storage and hook wiring. */
	private $trigger_registry_instance;

	/** @var WPSignal_Client Frontend script enqueue handler. */
	private $client_instance;

	/** @var WPSignal_Admin Admin pages and settings. */
	private $admin_instance;

	/**
	 * Get the singleton instance.
	 *
	 * Creates the instance on first call. Subsequent calls return the same
	 * object. This is the recommended way to access internal components:
	 *
	 *     $config = WPSignal::instance()->config();
	 *
	 * @return WPSignal
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/** Private constructor — use WPSignal::instance() instead. */
	private function __construct() {}

	/**
	 * Boot the plugin — instantiate and wire all components.
	 *
	 * Called once from wpsignal.php during plugin load. Performs the following:
	 *   1. Instantiate Config, Publisher, Token, TriggerRegistry, Client, Admin
	 *   2. Register built-in triggers (save_post → post.updated)
	 *   3. Fire 'wpsignal_loaded' action for third-party trigger registration
	 *   4. Hook REST route registration to rest_api_init
	 *   5. Initialize frontend client (wp_enqueue_scripts)
	 *   6. Initialize admin pages (if is_admin)
	 *
	 * @return void
	 */
	public function boot() {
		$this->config_instance           = new WPSignal_Config();
		$this->publisher_instance        = new WPSignal_Publisher( $this->config_instance );
		$this->token_instance            = new WPSignal_Token( $this->config_instance, $this->publisher_instance );
		$this->trigger_registry_instance = new WPSignal_Trigger_Registry( $this->publisher_instance );
		$this->client_instance           = new WPSignal_Client( $this->config_instance );
		$this->admin_instance            = new WPSignal_Admin( $this->config_instance );

		// Register built-in triggers.
		$this->trigger_registry_instance->register_defaults();

		/**
		 * Fires when WPSignal is fully loaded and ready for trigger registration.
		 *
		 * Third-party plugins should hook here to register custom triggers:
		 *
		 *     add_action( 'wpsignal_loaded', function () {
		 *         WPSignal::trigger( 'order.completed' )
		 *             ->on( 'woocommerce_order_status_completed' )
		 *             ->channel( 'orders' )
		 *             ->data( function ( $order_id ) {
		 *                 $order = wc_get_order( $order_id );
		 *                 return [ 'order_id' => $order_id, 'total' => $order->get_total() ];
		 *             } )
		 *             ->register();
		 *     } );
		 */
		do_action( 'wpsignal_loaded' );

		// REST routes.
		add_action( 'rest_api_init', array( $this->token_instance, 'register_routes' ) );

		// Frontend client.
		$this->client_instance->init();

		// Admin pages.
		if ( is_admin() ) {
			$this->admin_instance->init();
		}
	}

	// -- Component accessors ------------------------------------------------

	/**
	 * Get the configuration accessor.
	 *
	 * @return WPSignal_Config
	 */
	public function config() {
		return $this->config_instance;
	}

	/**
	 * Get the event publisher.
	 *
	 * @return WPSignal_Publisher
	 */
	public function publisher() {
		return $this->publisher_instance;
	}

	/**
	 * Get the token/REST handler.
	 *
	 * @return WPSignal_Token
	 */
	public function token() {
		return $this->token_instance;
	}

	/**
	 * Get the trigger registry.
	 *
	 * @return WPSignal_Trigger_Registry
	 */
	public function trigger_registry() {
		return $this->trigger_registry_instance;
	}

	// -- Static convenience methods -----------------------------------------

	/**
	 * Create a new trigger builder.
	 *
	 * Returns a fluent builder — chain ->on(), ->channel(), ->data(), ->when(),
	 * then call ->register() to wire it up.
	 *
	 * Example:
	 *
	 *     WPSignal::trigger( 'user.login' )
	 *         ->on( 'wp_login', 10, 2 )
	 *         ->data( function ( $user_login, $user ) {
	 *             return [ 'user_id' => $user->ID, 'login' => $user_login ];
	 *         } )
	 *         ->register();
	 *
	 * @param string $event Event name (e.g. "post.updated", "comment.created").
	 * @return WPSignal_Trigger A new trigger builder instance.
	 */
	public static function trigger( $event ) {
		return new WPSignal_Trigger( $event );
	}

	/**
	 * Publish an event directly (no hook needed).
	 *
	 * Sends an HMAC-signed POST to the WPSignal server. The plugin must be
	 * configured (site_key, site_secret, base_url) or this returns a WP_Error.
	 *
	 * Example:
	 *
	 *     WPSignal::publish( 'events', 'custom.event', [ 'key' => 'value' ] );
	 *
	 * @param string $channel Channel name (e.g. "events"). Scoped server-side.
	 * @param string $event   Event name (e.g. "post.updated").
	 * @param mixed  $data    Arbitrary data (will be JSON-encoded).
	 * @return array|WP_Error wp_remote_post response array on success, WP_Error on failure.
	 */
	public static function publish( $channel, $event, $data = array() ) {
		return self::instance()->publisher()->publish( $channel, $event, $data );
	}
}
