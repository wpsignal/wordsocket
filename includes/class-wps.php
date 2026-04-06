<?php
/**
 * WPSignal\WPS - main singleton facade.
 *
 * Central entry point for the plugin. Provides static convenience methods for
 * the two most common operations (registering triggers and publishing events)
 * and wires all internal components during boot().
 *
 * @usage: register a custom trigger:
 * ```php
 *     add_action( 'wpsignal_loaded', function () {
 *         WPS::trigger( 'comment.created' )
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
 * ```
 * @usage: publish an event directly (no hook):
 * ```php
 *     WPS::publish( 'events', 'custom.event', [ 'key' => 'value' ] );
 * ```
 * @package WordSocket
 */

namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WPSignal\WPS - main singleton facade.
 *
 * Central entry point for the plugin. Provides static convenience methods for
 * the two most common operations (registering triggers and publishing events)
 * and wires all internal components during boot().
 */
class WPS {

	/**
	 * WPS Singleton instance.
	 *
	 * @var WPS|null
	 */
	private static $instance;

	/**
	 * Configuration accessor.
	 *
	 * @var Config
	 */
	private $config_instance;

	/**
	 * Event publisher.
	 *
	 * @var Publisher
	 */
	private $publisher_instance;

	/**
	 * JWT minting and REST route handler.
	 *
	 * @var Token
	 */
	private $token_instance;

	/**
	 * Trigger storage and hook wiring.
	 *
	 * @var Trigger_Registry
	 */
	private $trigger_registry_instance;

	/**
	 * Frontend script enqueue handler.
	 *
	 * @var Client
	 */
	private $client_instance;

	/**
	 * Admin pages and settings.
	 *
	 * @var Admin_Page
	 */
	private $admin_instance;

	/**
	 * Browser-based OAuth connect flow handler.
	 *
	 * @var Connect
	 */
	private $connect_instance;

	/**
	 * REST endpoint for trigger management.
	 *
	 * @var Triggers_REST
	 */
	private $triggers_rest;

	/**
	 * Hydrates saved trigger configs into the registry.
	 *
	 * @var Custom_Triggers
	 */
	private $custom_triggers;

	/**
	 * Get the singleton instance.
	 *
	 * Creates the instance on first call. Subsequent calls return the same
	 * object. This is the recommended way to access internal components:
	 *
	 * @usage: get the configuration accessor:
	 * ```php
	 *     $config = WPSignal::instance()->config();
	 * ```
	 * @return WPS
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Private constructor: use WPS::instance() instead.
	 *
	 * @return void
	 */
	private function __construct() {}

	/**
	 * Boot the plugin: instantiate and wire all components.
	 *
	 * @return void
	 */
	public function boot() {
		$this->config_instance           = new Config();
		$this->publisher_instance        = new Publisher( $this->config_instance );
		$this->token_instance            = new Token( $this->config_instance, $this->publisher_instance );
		$this->trigger_registry_instance = new Trigger_Registry( $this->publisher_instance );
		$this->client_instance           = new Client( $this->config_instance, $this->token_instance );
		$this->admin_instance            = new Admin_Page( $this->config_instance );
		$this->connect_instance          = new Connect( $this->config_instance );
		$this->connect_instance->init();

		// Register built-in triggers.
		$this->trigger_registry_instance->register_defaults();

		// Hydrate custom triggers saved via the admin UI.
		$this->custom_triggers = new Custom_Triggers( $this->trigger_registry_instance );
		$this->custom_triggers->register_saved();

		/**
		 * Fires when WPSignal is fully loaded and ready for trigger registration. NB: this can only be called
		 * by plugins since this runs on `plugins_loaded` hook. Themes will need to use `init` hook instead.
		 *
		 * Third-party plugins should hook here to register custom triggers:
		 *
		 * @usage: register a custom trigger:
		 * ```php
		 *     add_action( 'wpsignal_loaded', function () {
		 *         WPS::trigger( 'order.completed' )
		 *             ->on( 'woocommerce_order_status_completed' )
		 *             ->channel( 'orders' )
		 *             ->data( function ( $order_id ) {
		 *                 $order = wc_get_order( $order_id );
		 *                 return [ 'order_id' => $order_id, 'total' => $order->get_total() ];
		 *             } )
		 *             ->register();
		 *     } );
		 * ```
		 */
		do_action( 'wpsignal_loaded' );

		// REST routes.
		add_action( 'rest_api_init', array( $this->token_instance, 'register_routes' ) );
		$this->triggers_rest = new Triggers_REST();
		add_action( 'rest_api_init', array( $this->triggers_rest, 'register_routes' ) );

		// Frontend client.
		$this->client_instance->init();

		// Admin pages.
		if ( is_admin() ) {
			$this->admin_instance->init();
		}

		// Register the "WordSocket" block category so example/third-party blocks
		// can use "wordsocket" as their category without registering it themselves.
		add_filter( 'block_categories_all', array( $this, 'register_block_category' ) );
	}

	/**
	 * Prepend the "WordSocket" block category to the editor category list.
	 *
	 * @param array $categories Existing block categories.
	 * @return array
	 */
	public function register_block_category( $categories ) {
		\array_unshift(
			$categories,
			array(
				'slug'  => 'wordsocket',
				'title' => 'WordSocket',
				'icon'  => null,
			)
		);
		return $categories;
	}

	/**
	 * Get the configuration accessor.
	 *
	 * @return Config
	 */
	public function config() {
		return $this->config_instance;
	}

	/**
	 * Get the event publisher.
	 *
	 * @return Publisher
	 */
	public function publisher() {
		return $this->publisher_instance;
	}

	/**
	 * Get the token/REST handler.
	 *
	 * @return Token
	 */
	public function token() {
		return $this->token_instance;
	}

	/**
	 * Get the trigger registry.
	 *
	 * @return Trigger_Registry
	 */
	public function trigger_registry() {
		return $this->trigger_registry_instance;
	}

	/**
	 * Create a new trigger builder.
	 *
	 * Returns a fluent builder: chain ->on(), ->channel(), ->data(), ->when(),
	 * then call ->register() to wire it up.
	 *
	 * @usage: create a new trigger builder:
	 * ```php
	 *     WPS::trigger( 'user.login' )
	 *         ->on( 'wp_login', 10, 2 )
	 *         ->data( function ( $user_login, $user ) {
	 *             return [ 'user_id' => $user->ID, 'login' => $user_login ];
	 *         } )
	 *         ->register();
	 * ```
	 * @param string $event Event name (e.g. "post.updated", "comment.created").
	 * @return Trigger A new trigger builder instance.
	 */
	public static function trigger( $event ) {
		return new Trigger( $event );
	}

	/**
	 * Publish an event directly (no hook needed).
	 *
	 * Sends an HMAC-signed POST to the WPSignal server. The plugin must be
	 * configured (site_key, site_secret, base_url) or this returns a WP_Error.
	 *
	 * @usage: publish an event directly (no hook):
	 * ```php
	 *     WPS::publish( 'events', 'custom.event', [ 'key' => 'value' ] );
	 * ```
	 * @param string $channel Channel name (e.g. "events"). Scoped server-side.
	 * @param string $event   Event name (e.g. "post.updated").
	 * @param mixed  $data    Arbitrary data (will be JSON-encoded).
	 * @return array|WP_Error wp_remote_post response array on success, WP_Error on failure.
	 */
	public static function publish( $channel, $event, $data = array() ) {
		return self::instance()->publisher()->publish( $channel, $event, $data );
	}
}
