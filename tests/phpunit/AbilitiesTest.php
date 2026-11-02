<?php
/**
 * Abilities (0.31): the category and the seven abilities, their permission, and what each does.
 */

use WPSignal\Abilities;
use WPSignal\Journeys;
use WPSignal\WPS;

final class AbilitiesTest extends WordSocketTestCase {

	private const V = '2d4e6f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
	private const N = '3e5f7a91-2b3c-4d4e-9fa0-1b2c3d4e5f60';

	/** @var array<string, mixed> */
	private array $saved_options = array();

	protected function setUp(): void {
		parent::setUp();
		if ( ! Abilities::available() ) {
			$this->markTestSkipped( 'This WordPress has no Abilities API.' );
		}
		foreach ( array( 'wpsignal_rules' ) as $name ) {
			$this->saved_options[ $name ] = get_option( $name, '__missing__' );
			delete_option( $name );
		}
		$this->clear();
	}

	protected function tearDown(): void {
		foreach ( $this->saved_options as $name => $value ) {
			if ( '__missing__' === $value ) {
				delete_option( $name );
			} else {
				update_option( $name, $value );
			}
		}
		$this->clear();
		wp_set_current_user( 0 );
		parent::tearDown();
	}

	private function clear(): void {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . Journeys::table() . ' WHERE visitor = UNHEX(%s)', Journeys::hex( self::V ) ) ); // phpcs:ignore WordPress.DB
	}

	/** Run an ability as the current user, through the API's own permission and validation. */
	private function execute( string $name, $input = array() ) {
		$ability = wp_get_ability( 'wordsocket/' . $name );
		$this->assertInstanceOf( WP_Ability::class, $ability, $name );
		return $ability->execute( $input );
	}

	/** A moment an agent might save: one condition, one Show. */
	private function moment( string $name = 'Agent moment' ): array {
		return array(
			'name'       => $name,
			'frequency'  => 'visit',
			'conditions' => array(
				'all' => array(
					array(
						'condition' => 'page_kind',
						'op'        => 'is',
						'value'     => 'home',
					),
				),
			),
			'actions'    => array(
				array(
					'action'       => 'show',
					'presentation' => array(
						'type'    => 'banner',
						'pattern' => 0,
						'text'    => 'Welcome back',
					),
				),
			),
		);
	}

	public function test_the_category_and_the_seven_abilities_are_registered_and_public(): void {
		$this->assertArrayHasKey( Abilities::CATEGORY, wp_get_ability_categories() );
		$registered = wp_get_abilities();
		foreach ( Abilities::NAMES as $name ) {
			$this->assertArrayHasKey( 'wordsocket/' . $name, $registered, $name );
			$ability = $registered[ 'wordsocket/' . $name ];
			$this->assertSame( Abilities::CATEGORY, $ability->get_category() );
			$this->assertTrue( (bool) $ability->get_meta_item( 'public' ), "$name is offered to clients" );
		}
		$this->assertTrue( wp_get_ability( 'wordsocket/describe-moments' )->get_meta_item( 'annotations' )['readonly'] );
		$this->assertTrue( wp_get_ability( 'wordsocket/delete-moment' )->get_meta_item( 'annotations' )['destructive'] );
	}

	public function test_every_ability_needs_manage_options(): void {
		$subscriber = wp_insert_user(
			array(
				'user_login' => 'wps-abil-sub-' . wp_generate_password( 6, false ),
				'user_pass'  => wp_generate_password(),
				'role'       => 'subscriber',
			)
		);
		try {
			wp_set_current_user( (int) $subscriber );
			foreach ( Abilities::NAMES as $name ) {
				$this->assertFalse( wp_get_ability( 'wordsocket/' . $name )->check_permissions( array() ), "$name refuses a subscriber" );
			}
			$result = $this->execute( 'list-moments' );
			$this->assertInstanceOf( WP_Error::class, $result );
			$this->as_admin();
			$this->assertTrue( wp_get_ability( 'wordsocket/list-moments' )->check_permissions( array() ) );
		} finally {
			wp_set_current_user( 0 );
			require_once ABSPATH . 'wp-admin/includes/user.php';
			wp_delete_user( (int) $subscriber );
		}
	}

	public function test_describe_moments_hands_an_agent_the_vocabulary_kinds_patterns_clock_and_limits(): void {
		$this->as_admin();
		$described = $this->execute( 'describe-moments' );
		$this->assertIsArray( $described );
		$this->assertSame( array( 'vocabulary', 'kinds', 'kindGroups', 'patterns', 'timezone', 'limits', 'moment' ), array_keys( $described ) );
		$this->assertSame( array( 'always', 'page', 'visit', 'visitor' ), array_keys( $described['moment']['frequency'] ) );
		$this->assertStringContainsString( 'flash', $described['moment']['attention'], 'the attention block is explained, not just accepted' );
		$this->assertContains( 'page_kind', array_column( $described['vocabulary']['conditions'], 'key' ) );
		$this->assertContains( 'show', array_column( $described['vocabulary']['actions'], 'key' ) );
		$this->assertArrayHasKey( 'home', $described['kinds'] );
		$this->assertSame( wp_timezone_string(), $described['timezone'] );
		$this->assertSame( \WPSignal\Rules::MAX_RULES, $described['limits']['moments'] );
	}

	public function test_a_moment_is_saved_off_switched_on_edited_and_deleted_through_the_abilities(): void {
		$this->connect_site();
		$this->fake_http( static fn() => array( 200, array( 'ok' => true ) ) );
		$this->as_admin();

		$saved = $this->execute( 'save-moment', array( 'moment' => $this->moment() ) );
		$this->assertIsArray( $saved, is_wp_error( $saved ) ? $saved->get_error_message() : '' );
		$this->assertMatchesRegularExpression( '/^[0-9a-f]{8}$/', $saved['id'] );
		$this->assertFalse( $saved['enabled'], 'a new moment is saved switched off' );
		$this->assertSame( 1, $saved['rev'] );
		$this->assertSame( 'Agent moment', $saved['name'] );
		$id = $saved['id'];

		$flashing = $this->execute(
			'save-moment',
			array(
				'moment' => array(
					'id'        => $id,
					'attention' => array(
						'enabled' => true,
						'title'   => 'Come back!',
					),
				) + $this->moment(),
			)
		);
		$this->assertTrue( $flashing['attention']['enabled'], 'the attention flash rides through the ability' );
		$this->assertSame( 'Come back!', $flashing['attention']['title'] );

		$listed = $this->execute( 'list-moments' );
		$this->assertContains( $id, array_column( $listed['moments'], 'id' ) );
		$this->assertSame( array(), array_column( WPS::rules()->enabled(), 'id' ), 'nothing reaches browsers yet' );

		$on = $this->execute( 'enable-moment', array( 'id' => $id, 'enabled' => true ) );
		$this->assertTrue( $on['enabled'] );
		$this->assertSame( 2, $on['rev'], 'a switch keeps the revision' );
		$this->assertContains( $id, array_column( WPS::rules()->enabled(), 'id' ) );

		$edited = $this->execute( 'save-moment', array( 'moment' => array( 'id' => $id ) + $this->moment( 'Renamed' ) ) );
		$this->assertSame( 'Renamed', $edited['name'] );
		$this->assertTrue( $edited['enabled'], 'an edit keeps the switch as it was' );
		$this->assertSame( 3, $edited['rev'], 'an edit re-arms the moment' );

		$publishes = array_filter( $this->requests, static fn( array $r ): bool => str_ends_with( (string) $r['url'], '/publish' ) );
		$this->assertCount( 4, $publishes, 'every save broadcasts rules.updated' );

		$deleted = $this->execute( 'delete-moment', array( 'id' => $id ) );
		$this->assertSame( array( 'deleted' => $id ), $deleted );
		$this->assertNotContains( $id, array_column( $this->execute( 'list-moments' )['moments'], 'id' ) );
		$this->assertInstanceOf( WP_Error::class, $this->execute( 'delete-moment', array( 'id' => $id ) ) );
		$this->assertInstanceOf( WP_Error::class, $this->execute( 'enable-moment', array( 'id' => 'nope', 'enabled' => true ) ) );
	}

	public function test_a_moment_the_vocabulary_cannot_validate_is_refused(): void {
		$this->connect_site();
		$this->fake_http( static fn() => array( 200, array( 'ok' => true ) ) );
		$this->as_admin();
		$moment                                 = $this->moment();
		$moment['conditions']['all'][0]['condition'] = 'nope';
		$result                                 = $this->execute( 'save-moment', array( 'moment' => $moment ) );
		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'wpsignal_invalid_rules', $result->get_error_code() );
		$this->assertInstanceOf( WP_Error::class, $this->execute( 'save-moment', array() ), 'the schema wants a moment' );
		$this->assertSame( array(), $this->requests, 'nothing was published' );
	}

	public function test_publish_event_sends_an_event_on_a_channel(): void {
		$this->connect_site();
		$this->fake_http( static fn() => array( 200, array( 'ok' => true ) ) );
		$this->as_admin();
		$result = $this->execute(
			'publish-event',
			array(
				'channel' => 'events',
				'event'   => 'agent.hello',
				'data'    => array( 'answer' => 42 ),
			)
		);
		$this->assertSame( array( 'ok' => true ), $result );
		$publishes = array_values( array_filter( $this->requests, static fn( array $r ): bool => str_ends_with( (string) $r['url'], '/publish' ) ) );
		$this->assertCount( 1, $publishes );
		$event = $this->open_publish( (string) $publishes[0]['args']['body'] );
		$this->assertSame( 'agent.hello', $event['event'] );
		$this->assertSame( 42, $event['data']['answer'] );
		$this->assertInstanceOf( WP_Error::class, $this->execute( 'publish-event', array( 'channel' => 'events' ) ), 'the schema wants an event' );
	}

	public function test_list_journeys_answers_records_with_a_legend(): void {
		$this->as_admin();
		update_option( 'wpsignal_history_enabled', true );
		$now = gmdate( 'Y-m-d H:i:s' );
		$this->assertTrue(
			Journeys::insert_row(
				array(
					'journey_id' => self::N,
					'visitor'    => self::V,
					'journey'    => 'home:1:4>search:0:9',
					'outcome'    => 'left',
					'ref'        => 'agent-ref',
					'value'      => 12.5,
					'started_at' => $now,
					'last_seen'  => $now,
				)
			)
		);
		$result = $this->execute(
			'list-journeys',
			array(
				'visitor' => self::V,
				'limit'   => 5,
			)
		);
		$this->assertIsArray( $result, is_wp_error( $result ) ? $result->get_error_message() : '' );
		$this->assertSame( 1, $result['count'] );
		$this->assertSame( array_keys( Journeys::legend() ), array_keys( $result['journeys'][0] ), 'a record carries every field the legend names' );
		$this->assertSame( self::N, $result['journeys'][0]['journey_id'] );
		$this->assertSame( 'home > search', $result['journeys'][0]['path'] );
		$this->assertSame( 'left', $result['journeys'][0]['outcome'] );
		$this->assertInstanceOf( WP_Error::class, $this->execute( 'list-journeys', array( 'visitor' => 'not-a-uuid' ) ) );
		$this->assertInstanceOf( WP_Error::class, $this->execute( 'list-journeys', array( 'limit' => 5000 ) ), 'the schema caps the limit' );
	}
}
