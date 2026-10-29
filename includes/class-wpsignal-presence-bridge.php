<?php
/**
 * Presence API bridge: writes WordPress's Presence API rows from relay presence.
 *
 * - The browser joins relay presence on `presence:admin` (every signed-in page) and `presence:post:{id}` (the post editor).
 * - The relay posts each join and leave on `presence:*` to `POST /wpsignal/v1/presence`, signed like a publish.
 * - The route writes `user-{id}` and `editor-{id}` with an hour's `expires_in`; the person's last leave leaves the row to lapse within a short grace, so a refresh never drops them.
 * - `set_presence` and `removed_presence` publish `presence.room_changed`, which open tabs turn into `presence-api.roomChanged`.
 *
 * @package WPSignal
 */

namespace WPSignal;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_Session_Tokens;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Feeds the Presence API feature plugin from connection-scoped relay presence.
 *
 * @since 0.32.0
 */
class Presence_Bridge {

	/** Channel every signed-in page joins; maps to the admin "who's online" room. */
	const ADMIN_CHANNEL = 'presence:admin';

	/** Channel prefix the post editor joins, followed by the post id; maps to the post's room. */
	const POST_CHANNEL_PREFIX = 'presence:post:';

	/** Channel `presence.room_changed` is published on. */
	const ROOMS_CHANNEL = 'presence:rooms';

	/** Event published on `ROOMS_CHANNEL` after every Presence API write or removal. */
	const ROOM_CHANGED_EVENT = 'presence.room_changed';

	/** How far a notification's timestamp may be from now, in milliseconds. */
	const TIMESTAMP_TOLERANCE_MS = 60000;

	/** Seconds a row outlives the person's last connection, covering a page refresh. */
	const LEAVE_GRACE = 10;

	/**
	 * Configuration accessor.
	 *
	 * @var Config
	 */
	private $config;

	/**
	 * Relay publisher, for `presence.room_changed`.
	 *
	 * @var Publisher
	 */
	private $publisher;

	/**
	 * The room whose row is being left to lapse during the current write, so its `room_changed` carries `recheck_in`.
	 *
	 * @var string
	 */
	private $releasing = '';

	/**
	 * Constructor.
	 *
	 * @param Config    $config    Configuration accessor.
	 * @param Publisher $publisher Relay publisher.
	 */
	public function __construct( Config $config, Publisher $publisher ) {
		$this->config    = $config;
		$this->publisher = $publisher;
	}

	/**
	 * Hook the route, the token channel and the room-changed publishes.
	 *
	 * @since 0.32.0
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_filter( 'wpsignal_token_channels', array( $this, 'token_channels' ), 10, 3 );
		add_action( 'set_presence', array( $this, 'on_room_changed' ) );
		add_action( 'removed_presence', array( $this, 'on_room_changed' ) );
		add_action( 'post_updated', array( $this, 'on_post_updated' ), 10, 3 );
	}

	/**
	 * Whether the bridge runs: Presence API is installed and recording, the site is connected, and nothing switched it off.
	 *
	 * @since 0.32.0
	 *
	 * @return bool
	 */
	public function is_active() {
		/**
		 * Filters whether WordSocket feeds the Presence API from relay presence.
		 *
		 * Return `false` to leave every Presence API surface to Heartbeat.
		 *
		 * @since 0.32.0
		 *
		 * @param bool $enabled Default: `true`.
		 */
		if ( ! apply_filters( 'wpsignal_presence_bridge', true ) ) {
			return false;
		}
		return function_exists( 'wp_presence_is_available' )
			&& wp_presence_is_available()
			&& $this->config->is_configured();
	}

	/**
	 * The rooms this page's client joins, as `{ rooms: [{ channel, state }] }`, or null when it joins none.
	 *
	 * @since 0.32.0
	 *
	 * @return array|null
	 */
	public function client_config() {
		if ( ! $this->is_active() || ! is_user_logged_in() ) {
			return null;
		}
		if ( ! wp_can_access_presence_room( wp_presence_admin_room() ) ) {
			return null;
		}
		if ( ! is_admin() && ! is_admin_bar_showing() ) {
			return null;
		}

		$rooms = array();
		if ( is_admin() ) {
			$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
			$state  = array(
				'screen' => $screen ? $screen->id : '',
				'title'  => wp_strip_all_tags( get_admin_page_title() ),
			);
			if ( $screen && 'post' === $screen->base ) {
				$post = get_post();
				if ( $post && wp_presence_post_room( $post ) ) {
					$state['post_id'] = $post->ID;
					$rooms[]          = array(
						'channel' => self::POST_CHANNEL_PREFIX . $post->ID,
						'state'   => array( 'screen' => $screen->id ),
					);
				}
			}
		} else {
			$state = array(
				'screen' => 'front',
				'title'  => is_front_page() ? __( 'Home', 'wordsocket' ) : wp_get_document_title(),
			);
			if ( is_singular() ) {
				$state['post_id'] = get_queried_object_id();
			}
		}
		array_unshift(
			$rooms,
			array(
				'channel' => self::ADMIN_CHANNEL,
				'state'   => $state,
			)
		);

		return array( 'rooms' => $rooms );
	}

	/**
	 * Add the rooms channel to a signed-in user's token.
	 *
	 * @since 0.32.0
	 *
	 * @param string[] $channels Channels the client subscribes to on connect.
	 * @param int      $user_id  Current user ID.
	 * @param string   $site_id  Hashed site identifier.
	 * @return string[]
	 */
	public function token_channels( $channels, $user_id, $site_id ) {
		if ( $user_id && $this->is_active() ) {
			$channels[] = 'site:' . $site_id . ':' . self::ROOMS_CHANNEL;
		}
		return $channels;
	}

	/**
	 * Publish `presence.room_changed` for a room that was written or emptied, with `recheck_in` (ms) when a row was left to lapse.
	 *
	 * @since 0.32.0
	 *
	 * @param string $room The Presence API room.
	 * @return void
	 */
	public function on_room_changed( $room ) {
		if ( ! $this->is_active() ) {
			return;
		}
		$data = array( 'room' => (string) $room );
		if ( $this->releasing === (string) $room ) {
			$data['recheck_in'] = self::LEAVE_GRACE * 1000;
		}
		$this->publisher->publish( self::ROOMS_CHANNEL, self::ROOM_CHANGED_EVENT, $data );
	}

	/**
	 * Publish `presence.room_changed` for a post's room and the admin room when its title or status changes while someone is editing it, since the surfaces print the post, not the row.
	 *
	 * @since 0.32.0
	 *
	 * @param int      $post_id The post.
	 * @param \WP_Post $after   The post as saved.
	 * @param \WP_Post $before  The post as it was.
	 * @return void
	 */
	public function on_post_updated( $post_id, $after, $before ) {
		if ( $after->post_title === $before->post_title && $after->post_status === $before->post_status ) {
			return;
		}
		if ( ! $this->is_active() ) {
			return;
		}
		$room = wp_presence_post_room( $after );
		if ( ! $room || ! wp_get_presence( $room ) ) {
			return;
		}
		$this->on_room_changed( $room );
		$this->on_room_changed( wp_presence_admin_room() );
	}

	/**
	 * Register `POST /wpsignal/v1/presence`, the route the relay posts to.
	 *
	 * @since 0.32.0
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			'wpsignal/v1',
			'/presence',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'handle_notification' ),
				'permission_callback' => array( $this, 'verify_signature' ),
			)
		);
	}

	/**
	 * Permission callback: 404 while the bridge is off, else the relay's HMAC over `body + "." + timestamp` with the site secret, within the time tolerance.
	 *
	 * @since 0.32.0
	 *
	 * @param WP_REST_Request $request The request.
	 * @return true|WP_Error
	 */
	public function verify_signature( WP_REST_Request $request ) {
		if ( ! $this->is_active() ) {
			return new WP_Error( 'wpsignal_presence_bridge_off', __( 'The Presence API bridge is not active on this site.', 'wordsocket' ), array( 'status' => 404 ) );
		}
		$key       = (string) $request->get_header( 'x_wp_signal_key' );
		$timestamp = (string) $request->get_header( 'x_wp_signal_ts' );
		$signature = (string) $request->get_header( 'x_wp_signal_sign' );
		$refused   = new WP_Error( 'wpsignal_bad_signature', __( 'The request is not signed by the relay.', 'wordsocket' ), array( 'status' => 401 ) );

		if ( '' === $key || '' === $signature || ! ctype_digit( $timestamp ) ) {
			return $refused;
		}
		if ( ! hash_equals( (string) $this->config->site_key(), $key ) ) {
			return $refused;
		}
		if ( abs( round( microtime( true ) * 1000 ) - (float) $timestamp ) > self::TIMESTAMP_TOLERANCE_MS ) {
			return $refused;
		}
		$expected = hash_hmac( 'sha256', $request->get_body() . '.' . $timestamp, (string) $this->config->site_secret() );
		if ( ! hash_equals( $expected, $signature ) ) {
			return $refused;
		}
		return true;
	}

	/**
	 * Apply a relay notification: a `join` or `leave` with the person's other connections, or a `sync` of every member.
	 *
	 * @since 0.32.0
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function handle_notification( WP_REST_Request $request ) {
		$body  = $request->get_json_params();
		$event = isset( $body['event'] ) ? (string) $body['event'] : '';

		if ( 'sync' === $event ) {
			$results = array();
			$members = isset( $body['members'] ) && is_array( $body['members'] ) ? $body['members'] : array();
			foreach ( $members as $index => $member ) {
				$others = $members;
				unset( $others[ $index ] );
				$results[] = $this->apply(
					(string) ( $member['channel'] ?? '' ),
					(int) ( $member['user_id'] ?? 0 ),
					is_array( $member['state'] ?? null ) ? $member['state'] : array(),
					$this->connections_of( (int) ( $member['user_id'] ?? 0 ), $others ),
					false
				);
			}
			return new WP_REST_Response(
				array(
					'ok'      => true,
					'results' => $results,
				)
			);
		}

		if ( 'join' !== $event && 'leave' !== $event ) {
			return new WP_Error( 'wpsignal_bad_event', __( 'Unknown presence event.', 'wordsocket' ), array( 'status' => 400 ) );
		}

		$user_id = (int) ( $body['user_id'] ?? 0 );
		$result  = $this->apply(
			(string) ( $body['channel'] ?? '' ),
			$user_id,
			is_array( $body['state'] ?? null ) ? $body['state'] : array(),
			$this->connections_of( $user_id, isset( $body['others'] ) && is_array( $body['others'] ) ? $body['others'] : array() ),
			'leave' === $event
		);

		return new WP_REST_Response(
			array(
				'ok'     => true,
				'result' => $result,
			)
		);
	}

	/**
	 * The `{ channel, state }` entries of a user's connections from a list that may carry a `user_id` (a sync) or not (`others`).
	 *
	 * @param int   $user_id The user.
	 * @param array $entries The entries.
	 * @return array
	 */
	private function connections_of( $user_id, array $entries ) {
		$mine = array();
		foreach ( $entries as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}
			if ( isset( $entry['user_id'] ) && (int) $entry['user_id'] !== $user_id ) {
				continue;
			}
			$mine[] = array(
				'channel' => (string) ( $entry['channel'] ?? '' ),
				'state'   => is_array( $entry['state'] ?? null ) ? $entry['state'] : array(),
			);
		}
		return $mine;
	}

	/**
	 * Write or remove the row a channel maps to for one person, from the connection that changed and their other connections.
	 *
	 * @since 0.32.0
	 *
	 * @param string $channel Site-relative channel, `presence:admin` or `presence:post:{id}`.
	 * @param int    $user_id The person.
	 * @param array  $state   The changed connection's presence state.
	 * @param array  $others  The person's other connections, `[{ channel, state }]`.
	 * @param bool   $leaving Whether the changed connection left the channel.
	 * @return string What happened: `written`, `released`, `skipped` or `ignored`.
	 */
	public function apply( $channel, $user_id, array $state, array $others, $leaving ) {
		$room = $this->room_for( $channel );
		if ( ! $room || $user_id <= 0 ) {
			return 'ignored';
		}
		$client_id = ( self::ADMIN_CHANNEL === $channel ? 'user-' : 'editor-' ) . $user_id;

		$connections = array();
		foreach ( $others as $other ) {
			if ( $other['channel'] === $channel ) {
				$connections[] = $other['state'];
			}
		}
		if ( ! $leaving ) {
			array_unshift( $connections, $state );
		}

		if ( ! $connections ) {
			$this->release( $room, $client_id, $user_id );
			return 'released';
		}
		if ( ! $this->has_session( $user_id ) || ! wp_can_access_presence_room( $room, $user_id ) ) {
			return 'skipped';
		}

		$visible = false;
		foreach ( $connections as $connection ) {
			if ( empty( $connection['hidden'] ) ) {
				$visible = true;
				break;
			}
		}
		$expires_in = $visible ? wp_presence_max_expires_in() : wp_presence_get_timeout();

		wp_set_presence(
			$room,
			$client_id,
			$this->row_state( $channel, $room, $user_id, $connections[0] ),
			array(
				'user_id'    => $user_id,
				'expires_in' => $expires_in,
			)
		);
		return 'written';
	}

	/**
	 * Re-stamp a row to lapse within `LEAVE_GRACE`, keeping its state, so a refresh's leave and join never show a gap.
	 *
	 * @param string $room      The room.
	 * @param string $client_id The row's client id.
	 * @param int    $user_id   The person.
	 * @return void
	 */
	private function release( $room, $client_id, $user_id ) {
		$state = null;
		foreach ( wp_get_presence( $room, array( 'client_prefix' => $client_id ) ) as $row ) {
			if ( $row->client_id === $client_id ) {
				$state = is_array( $row->data ) ? $row->data : array();
				break;
			}
		}
		if ( null === $state ) {
			return;
		}
		$this->releasing = $room;
		wp_set_presence(
			$room,
			$client_id,
			$state,
			array(
				'user_id'    => $user_id,
				'expires_in' => self::LEAVE_GRACE,
			)
		);
		$this->releasing = '';
	}

	/**
	 * The Presence API room a bridged channel names, or false for a channel that is not bridged or a post that is gone.
	 *
	 * @param string $channel Site-relative channel.
	 * @return string|false
	 */
	private function room_for( $channel ) {
		if ( self::ADMIN_CHANNEL === $channel ) {
			return wp_presence_admin_room();
		}
		if ( 0 === strpos( $channel, self::POST_CHANNEL_PREFIX ) ) {
			$post_id = substr( $channel, strlen( self::POST_CHANNEL_PREFIX ) );
			if ( ctype_digit( $post_id ) ) {
				return wp_presence_post_room( (int) $post_id );
			}
		}
		return false;
	}

	/**
	 * Whether the user still has a WordPress session, so a socket that outlives a logout writes nothing.
	 *
	 * @param int $user_id The user.
	 * @return bool
	 */
	private function has_session( $user_id ) {
		return ! empty( WP_Session_Tokens::get_instance( $user_id )->get_all() );
	}

	/**
	 * The row state for a room, built from the browser's state as the Heartbeat handlers build theirs.
	 *
	 * @param string $channel Site-relative channel.
	 * @param string $room    The room.
	 * @param int    $user_id The person.
	 * @param array  $state   The browser's presence state.
	 * @return array
	 */
	private function row_state( $channel, $room, $user_id, array $state ) {
		$screen = isset( $state['screen'] ) ? substr( sanitize_text_field( (string) $state['screen'] ), 0, WP_PRESENCE_MAX_KEY_LENGTH ) : '';

		if ( self::ADMIN_CHANNEL !== $channel ) {
			$parsed = wp_presence_parse_room( $room );

			/** This filter is documented in presence-api/includes/heartbeat.php */
			return apply_filters( 'wp_presence_editor_state', wp_presence_editor_state( $screen, false ), $parsed ? $parsed['post_id'] : 0, $user_id );
		}

		$row     = array( 'screen' => $screen );
		$post_id = isset( $state['post_id'] ) ? absint( $state['post_id'] ) : 0;
		if ( $post_id && post_type_exists( $screen ) ) {
			$post = get_post( $post_id );
			if ( $post && user_can( $user_id, 'edit_post', $post_id ) && isset( get_post_stati()[ $post->post_status ] ) ) {
				$row['post_status'] = $post->post_status;
			}
		}
		if ( ! empty( $state['title'] ) ) {
			$row['title'] = wp_html_excerpt( sanitize_text_field( (string) $state['title'] ), 200 );
		}
		if ( $post_id && 'front' === $screen ) {
			$post = get_post( $post_id );
			if ( $post && user_can( $user_id, 'read_post', $post->ID ) ) {
				$row['post_id'] = $post->ID;
			}
		}
		return $row;
	}
}
