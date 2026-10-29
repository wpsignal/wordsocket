<?php
/**
 * Presence_Bridge: the relay's signed notifications become Presence API rows.
 *
 * Runs only where the Presence API feature plugin is active and recording.
 */

use WPSignal\Presence_Bridge;
use WPSignal\WPS;

final class PresenceBridgeTest extends WordSocketTestCase {

	private const SITE_KEY = 'testsitekey0000';
	private const SECRET   = 'testsecret';

	/** @var int The administrator the notifications are about. */
	private $user_id = 0;

	/** @var string The session created for that user, destroyed in tearDown. */
	private $session = '';

	/** @var int A post for the editor room, deleted in tearDown. */
	private $post_id = 0;

	protected function setUp(): void {
		parent::setUp();
		if ( ! function_exists( 'wp_presence_is_available' ) || ! wp_presence_is_available() ) {
			$this->markTestSkipped( 'Presence API is not active on the target site.' );
		}
		$this->connect_site( self::SITE_KEY, self::SECRET );
		// Every Presence API write publishes `presence.room_changed`; keep those off the wire.
		$this->fake_http( fn() => array( 200, array( 'ok' => true ) ) );
		$admins        = get_users(
			array(
				'role'   => 'administrator',
				'number' => 1,
				'fields' => 'ID',
			)
		);
		$this->user_id = (int) $admins[0];
		$this->session = WP_Session_Tokens::get_instance( $this->user_id )->create( time() + HOUR_IN_SECONDS );
		$this->post_id = (int) wp_insert_post(
			array(
				'post_title'  => 'Presence bridge test',
				'post_status' => 'draft',
				'post_author' => $this->user_id,
			)
		);
		$this->forget_rows();
	}

	protected function tearDown(): void {
		$this->forget_rows();
		if ( $this->session ) {
			WP_Session_Tokens::get_instance( $this->user_id )->destroy( $this->session );
		}
		if ( $this->post_id ) {
			wp_delete_post( $this->post_id, true );
		}
		wp_set_current_user( 0 );
		parent::tearDown();
	}

	private function forget_rows(): void {
		wp_remove_presence( wp_presence_admin_room(), 'user-' . $this->user_id );
		if ( $this->post_id ) {
			wp_remove_presence( wp_presence_post_room( $this->post_id ), 'editor-' . $this->user_id );
		}
	}

	private function bridge(): Presence_Bridge {
		return WPS::instance()->presence_bridge();
	}

	/** The stored row, or null. */
	private function row( string $room, string $client_id ): ?object {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return $wpdb->get_row( $wpdb->prepare( "SELECT user_id, data, date_gmt, expires_gmt FROM {$wpdb->presence} WHERE room = %s AND client_id = %s", $room, $client_id ) );
	}

	/** Seconds between a row's write and its expiry. */
	private function window( object $row ): int {
		return strtotime( $row->expires_gmt . ' UTC' ) - strtotime( $row->date_gmt . ' UTC' );
	}

	/** Post a notification the way the relay does; returns [status, data]. */
	private function notify( array $body, ?string $timestamp = null, ?string $signature = null ): array {
		$json      = wp_json_encode( $body );
		$timestamp = $timestamp ?? (string) round( microtime( true ) * 1000 );
		$signature = $signature ?? hash_hmac( 'sha256', $json . '.' . $timestamp, self::SECRET );
		$request   = new WP_REST_Request( 'POST', '/wpsignal/v1/presence' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_header( 'X-WP-Signal-Key', self::SITE_KEY );
		$request->set_header( 'X-WP-Signal-Ts', $timestamp );
		$request->set_header( 'X-WP-Signal-Sign', $signature );
		$request->set_body( $json );
		$response = rest_do_request( $request );
		return array( $response->get_status(), $response->get_data() );
	}

	private function leave( string $channel, array $others = array(), string $id = 'conn-1' ): array {
		return $this->notify(
			array(
				'event'   => 'leave',
				'channel' => $channel,
				'id'      => $id,
				'user_id' => (string) $this->user_id,
				'state'   => null,
				'ts'      => 2,
				'others'  => $others,
			)
		);
	}

	/** The newest publish the bridge made, opened. */
	private function last_publish(): array {
		$publishes = array_values( array_filter( $this->requests, fn( $r ) => str_ends_with( $r['url'], '/publish' ) ) );
		return $this->open_publish( end( $publishes )['args']['body'] );
	}

	private function join( string $channel, array $state = array(), array $others = array() ): array {
		return $this->notify(
			array(
				'event'   => 'join',
				'channel' => $channel,
				'id'      => 'conn-1',
				'user_id' => (string) $this->user_id,
				'state'   => (object) $state,
				'ts'      => 1,
				'others'  => $others,
			)
		);
	}

	public function test_the_route_refuses_what_the_relay_did_not_sign(): void {
		$body = array(
			'event'   => 'join',
			'channel' => Presence_Bridge::ADMIN_CHANNEL,
			'user_id' => (string) $this->user_id,
			'state'   => array(),
			'others'  => array(),
		);

		list( $status ) = $this->notify( $body, null, 'deadbeef' );
		$this->assertSame( 401, $status, 'a wrong signature' );

		$stale = (string) ( round( microtime( true ) * 1000 ) - 120000 );
		list( $status ) = $this->notify( $body, $stale );
		$this->assertSame( 401, $status, 'a stale timestamp' );

		$request  = new WP_REST_Request( 'POST', '/wpsignal/v1/presence' );
		$response = rest_do_request( $request );
		$this->assertSame( 401, $response->get_status(), 'no headers at all' );

		$this->assertNull( $this->row( wp_presence_admin_room(), 'user-' . $this->user_id ) );
	}

	public function test_the_route_is_404_while_the_bridge_is_off(): void {
		add_filter( 'wpsignal_presence_bridge', '__return_false' );
		list( $status, $data ) = $this->join( Presence_Bridge::ADMIN_CHANNEL );
		remove_filter( 'wpsignal_presence_bridge', '__return_false' );
		$this->assertSame( 404, $status );
		$this->assertSame( 'wpsignal_presence_bridge_off', $data['code'] );
	}

	public function test_a_join_writes_the_person_row_for_an_hour(): void {
		list( $status, $data ) = $this->join(
			Presence_Bridge::ADMIN_CHANNEL,
			array(
				'screen' => 'dashboard',
				'title'  => 'Dashboard <b>x</b>',
			)
		);
		$this->assertSame( 200, $status );
		$this->assertSame( 'written', $data['result'] );

		$row = $this->row( wp_presence_admin_room(), 'user-' . $this->user_id );
		$this->assertNotNull( $row );
		$this->assertSame( $this->user_id, (int) $row->user_id );
		$this->assertEqualsWithDelta( HOUR_IN_SECONDS, $this->window( $row ), 5 );
		$state = json_decode( $row->data, true );
		$this->assertSame( 'dashboard', $state['screen'] );
		$this->assertSame( 'Dashboard x', $state['title'] );
	}

	public function test_hidden_connections_get_the_ttl_and_a_visible_one_the_hour_again(): void {
		$this->join( Presence_Bridge::ADMIN_CHANNEL, array( 'screen' => 'dashboard', 'hidden' => true ) );
		$row = $this->row( wp_presence_admin_room(), 'user-' . $this->user_id );
		$this->assertEqualsWithDelta( wp_presence_get_timeout(), $this->window( $row ), 5, 'every connection hidden: the TTL' );

		// A hidden tab plus another tab of the same person that is visible: the hour.
		$this->join(
			Presence_Bridge::ADMIN_CHANNEL,
			array( 'screen' => 'dashboard', 'hidden' => true ),
			array(
				array(
					'id'      => 'conn-2',
					'channel' => Presence_Bridge::ADMIN_CHANNEL,
					'state'   => array( 'screen' => 'edit-post' ),
				),
			)
		);
		$row = $this->row( wp_presence_admin_room(), 'user-' . $this->user_id );
		$this->assertEqualsWithDelta( HOUR_IN_SECONDS, $this->window( $row ), 5, 'one visible connection: the hour' );
	}

	public function test_a_leave_keeps_the_row_while_another_connection_remains_and_releases_it_on_the_last(): void {
		$this->join( Presence_Bridge::ADMIN_CHANNEL, array( 'screen' => 'dashboard' ) );
		$room      = wp_presence_admin_room();
		$client_id = 'user-' . $this->user_id;

		list( , $data ) = $this->leave(
			Presence_Bridge::ADMIN_CHANNEL,
			array(
				array(
					'id'      => 'conn-2',
					'channel' => Presence_Bridge::ADMIN_CHANNEL,
					'state'   => array( 'screen' => 'upload' ),
				),
				array(
					'id'      => 'conn-3',
					'channel' => Presence_Bridge::POST_CHANNEL_PREFIX . $this->post_id,
					'state'   => array( 'screen' => 'post' ),
				),
			)
		);
		$this->assertSame( 'written', $data['result'] );
		$row = $this->row( $room, $client_id );
		$this->assertNotNull( $row, 'another tab of the same person is still on the admin room' );
		$this->assertSame( 'upload', json_decode( $row->data, true )['screen'], 'the row now describes the connection that remains' );

		list( , $data ) = $this->leave(
			Presence_Bridge::ADMIN_CHANNEL,
			array(
				array(
					'id'      => 'conn-3',
					'channel' => Presence_Bridge::POST_CHANNEL_PREFIX . $this->post_id,
					'state'   => array( 'screen' => 'post' ),
				),
			),
			'conn-2'
		);
		$this->assertSame( 'released', $data['result'], 'a connection on another room does not keep this room' );
		$row = $this->row( $room, $client_id );
		$this->assertNotNull( $row, 'the row is left to lapse rather than deleted, so a refresh shows no gap' );
		$this->assertLessThanOrEqual( Presence_Bridge::LEAVE_GRACE, $this->window( $row ) );
		$this->assertSame( 'upload', json_decode( $row->data, true )['screen'], 'the row keeps its last state' );

		$event = $this->last_publish();
		$this->assertSame( Presence_Bridge::ROOM_CHANGED_EVENT, $event['event'] );
		$this->assertSame( Presence_Bridge::LEAVE_GRACE * 1000, $event['data']['recheck_in'], 'open tabs are told when to look again' );

		list( , $data ) = $this->leave( Presence_Bridge::ADMIN_CHANNEL, array(), 'conn-9' );
		$this->assertSame( 'released', $data['result'], 'a leave for a person with no row writes nothing' );
	}

	public function test_the_post_channel_writes_the_editor_row_in_the_post_room(): void {
		list( , $data ) = $this->join( Presence_Bridge::POST_CHANNEL_PREFIX . $this->post_id, array( 'screen' => 'post' ) );
		$this->assertSame( 'written', $data['result'] );

		$row = $this->row( wp_presence_post_room( $this->post_id ), 'editor-' . $this->user_id );
		$this->assertNotNull( $row );
		$this->assertEqualsWithDelta( HOUR_IN_SECONDS, $this->window( $row ), 5 );
		$state = json_decode( $row->data, true );
		$this->assertSame( 'editing', $state['action'] );
		$this->assertSame( 'post', $state['screen'] );

		list( , $data ) = $this->join( Presence_Bridge::POST_CHANNEL_PREFIX . '999999999', array( 'screen' => 'post' ) );
		$this->assertSame( 'ignored', $data['result'], 'a post that does not exist has no room' );

		list( , $data ) = $this->join( 'carts', array() );
		$this->assertSame( 'ignored', $data['result'], 'a channel outside the namespace' );
	}

	public function test_a_post_page_moving_on_ends_its_editor_row_at_once(): void {
		$channel   = Presence_Bridge::POST_CHANNEL_PREFIX . $this->post_id;
		$room      = wp_presence_post_room( $this->post_id );
		$client_id = 'editor-' . $this->user_id;
		$this->join( $channel, array( 'screen' => 'post' ) );
		$this->assertNotNull( $this->row( $room, $client_id ) );

		list( , $data ) = $this->join(
			$channel,
			array(
				'screen'  => 'post',
				'leaving' => true,
			)
		);
		$this->assertSame( 'ended', $data['result'] );
		$this->assertNull( $this->row( $room, $client_id ), 'the row is removed rather than left to lapse' );

		$event = $this->last_publish();
		$this->assertSame( Presence_Bridge::ROOM_CHANGED_EVENT, $event['event'] );
		$this->assertSame( $room, $event['data']['room'] );
		$this->assertArrayNotHasKey( 'recheck_in', $event['data'], 'nothing is left to lapse, so there is nothing to look at again' );

		list( , $data ) = $this->leave( $channel );
		$this->assertSame( 'released', $data['result'], 'the socket closing afterwards finds nothing to re-stamp' );
		$this->assertNull( $this->row( $room, $client_id ) );
	}

	public function test_leaving_keeps_the_row_for_another_tab_on_the_post_and_means_nothing_on_the_admin_room(): void {
		$channel        = Presence_Bridge::POST_CHANNEL_PREFIX . $this->post_id;
		list( , $data ) = $this->join(
			$channel,
			array(
				'screen'  => 'post',
				'leaving' => true,
			),
			array(
				array(
					'id'      => 'conn-2',
					'channel' => $channel,
					'state'   => array( 'screen' => 'site-editor' ),
				),
			)
		);
		$this->assertSame( 'written', $data['result'] );
		$row = $this->row( wp_presence_post_room( $this->post_id ), 'editor-' . $this->user_id );
		$this->assertSame( 'site-editor', json_decode( $row->data, true )['screen'], 'the row now describes the tab that stays' );

		list( , $data ) = $this->join(
			Presence_Bridge::ADMIN_CHANNEL,
			array(
				'screen'  => 'dashboard',
				'leaving' => true,
			)
		);
		$this->assertSame( 'written', $data['result'] );
		$row = $this->row( wp_presence_admin_room(), 'user-' . $this->user_id );
		$this->assertNotNull( $row, 'every admin page rejoins the admin room, so its row is rewritten rather than ended' );
		$this->assertArrayNotHasKey( 'leaving', json_decode( $row->data, true ), 'the flag never reaches the row' );
	}

	public function test_a_person_without_a_session_is_not_written(): void {
		WP_Session_Tokens::get_instance( $this->user_id )->destroy_all();
		$this->session = '';

		list( , $data ) = $this->join( Presence_Bridge::ADMIN_CHANNEL, array( 'screen' => 'dashboard' ) );
		$this->assertSame( 'skipped', $data['result'] );
		$this->assertNull( $this->row( wp_presence_admin_room(), 'user-' . $this->user_id ) );
	}

	public function test_a_sync_writes_every_member(): void {
		list( $status, $data ) = $this->notify(
			array(
				'event'   => 'sync',
				'ts'      => 4,
				'members' => array(
					array(
						'id'      => 'conn-1',
						'channel' => Presence_Bridge::ADMIN_CHANNEL,
						'user_id' => (string) $this->user_id,
						'state'   => array( 'screen' => 'dashboard' ),
					),
					array(
						'id'      => 'conn-1',
						'channel' => Presence_Bridge::POST_CHANNEL_PREFIX . $this->post_id,
						'user_id' => (string) $this->user_id,
						'state'   => array( 'screen' => 'post' ),
					),
				),
			)
		);
		$this->assertSame( 200, $status );
		$this->assertSame( array( 'written', 'written' ), $data['results'] );
		$this->assertNotNull( $this->row( wp_presence_admin_room(), 'user-' . $this->user_id ) );
		$this->assertNotNull( $this->row( wp_presence_post_room( $this->post_id ), 'editor-' . $this->user_id ) );
	}

	public function test_a_write_publishes_room_changed_on_the_rooms_channel(): void {
		wp_set_presence( wp_presence_admin_room(), 'user-' . $this->user_id, array( 'screen' => 'dashboard' ), array( 'user_id' => $this->user_id ) );

		$publishes = array_values( array_filter( $this->requests, fn( $r ) => str_ends_with( $r['url'], '/publish' ) ) );
		$this->assertNotEmpty( $publishes );
		$event = $this->open_publish( $publishes[0]['args']['body'] );
		$this->assertSame( Presence_Bridge::ROOMS_CHANNEL, $event['channel'] );
		$this->assertSame( Presence_Bridge::ROOM_CHANGED_EVENT, $event['event'] );
		$this->assertSame( wp_presence_admin_room(), $event['data']['room'] );
		$this->assertArrayNotHasKey( 'recheck_in', $event['data'], 'a plain write asks for no recheck' );
	}

	public function test_a_title_or_status_change_on_a_post_being_edited_publishes_room_changed(): void {
		$publishes = fn() => array_values( array_filter( $this->requests, fn( $r ) => str_ends_with( $r['url'], '/publish' ) ) );

		// Nobody in the room: a save publishes nothing.
		wp_update_post(
			array(
				'ID'         => $this->post_id,
				'post_title' => 'Renamed while empty',
			)
		);
		$this->assertCount( 0, $publishes() );

		$this->join( Presence_Bridge::POST_CHANNEL_PREFIX . $this->post_id, array( 'screen' => 'post' ) );
		$before = 1;

		wp_update_post(
			array(
				'ID'          => $this->post_id,
				'post_title'  => 'Published now',
				'post_status' => 'publish',
			)
		);
		// WordSocket's own post triggers publish too; keep only the room changes.
		$rooms_changed = function () use ( $publishes ) {
			$rooms = array();
			foreach ( $publishes() as $r ) {
				$event = $this->open_publish( $r['args']['body'] );
				if ( Presence_Bridge::ROOM_CHANGED_EVENT === $event['event'] ) {
					$rooms[] = $event['data']['room'];
				}
			}
			return $rooms;
		};
		$rooms = array_slice( $rooms_changed(), $before );
		$this->assertContains( wp_presence_post_room( $this->post_id ), $rooms );
		$this->assertContains( wp_presence_admin_room(), $rooms );

		// A save that changes neither title nor status is quiet.
		$before = count( $rooms_changed() );
		wp_update_post(
			array(
				'ID'           => $this->post_id,
				'post_content' => 'Body only',
			)
		);
		$this->assertCount( $before, $rooms_changed() );
	}

	public function test_the_token_lists_the_rooms_channel_for_a_signed_in_user_only(): void {
		wp_set_current_user( $this->user_id );
		$token   = WPS::instance()->token()->mint();
		$site_id = hash( 'sha256', 'site:' . self::SITE_KEY );
		$this->assertContains( 'site:' . $site_id . ':' . Presence_Bridge::ROOMS_CHANNEL, $token['channels'] );

		wp_set_current_user( 0 );
		$token = WPS::instance()->token()->mint();
		$this->assertNotContains( 'site:' . $site_id . ':' . Presence_Bridge::ROOMS_CHANNEL, $token['channels'] );
	}

	public function test_the_client_config_names_the_rooms_of_an_admin_page(): void {
		$this->assertNull( $this->bridge()->client_config(), 'a guest joins nothing' );

		wp_set_current_user( $this->user_id );
		require_once ABSPATH . 'wp-admin/includes/class-wp-screen.php';
		require_once ABSPATH . 'wp-admin/includes/screen.php';
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		set_current_screen( 'dashboard' );
		$config = $this->bridge()->client_config();
		$this->assertSame( Presence_Bridge::ADMIN_CHANNEL, $config['rooms'][0]['channel'] );
		$this->assertSame( 'dashboard', $config['rooms'][0]['state']['screen'] );
		$this->assertCount( 1, $config['rooms'] );

		$GLOBALS['post'] = get_post( $this->post_id ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		set_current_screen( 'post' );
		$config = $this->bridge()->client_config();
		$this->assertSame( Presence_Bridge::POST_CHANNEL_PREFIX . $this->post_id, $config['rooms'][1]['channel'] );
		$this->assertSame( $this->post_id, $config['rooms'][0]['state']['post_id'] );
		unset( $GLOBALS['post'] );
		$GLOBALS['current_screen'] = null; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
	}
}
