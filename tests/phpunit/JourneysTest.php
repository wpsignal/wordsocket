<?php
/**
 * Journeys: the history table, what the visit, leave and fired reports write to it, the extension
 * API, the feed, the visuals, the prune, the privacy tools and the routes.
 */

use WPSignal\Journeys;
use WPSignal\WPS;

final class JourneysTest extends WordSocketTestCase {

	private const V  = '0b2b6a4e-9f0a-4c7a-8f1c-1d2e3f4a5b6c';
	private const V2 = '1c3c7b5f-0a1b-4d8b-9a2d-2e3f4a5b6c7d';
	private const N  = '7c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
	private const N2 = '8d2e3f4a-5b6c-4d7e-9f80-1b2c3d4e5f60';
	private const N3 = '9e3f4a5b-6c7d-4e8f-a091-2c3d4e5f6071';

	protected function setUp(): void {
		parent::setUp();
		$this->clear();
		update_option( 'wpsignal_history_enabled', true );
		delete_transient( Journeys::VISUALS_TRANSIENT );
	}

	protected function tearDown(): void {
		$this->clear();
		remove_all_filters( 'wpsignal_journey_record' );
		remove_all_filters( 'wpsignal_journey_context' );
		remove_all_filters( 'wpsignal_journeys_currency' );
		parent::tearDown();
	}

	/** Every row the tests wrote: their visitors are the two constants. */
	private function clear(): void {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . Journeys::table() . ' WHERE visitor IN (%s, %s)', self::V, self::V2 ) ); // phpcs:ignore WordPress.DB
	}

	/** A report as the visit and leave routes hand it to the actions. */
	private function report( string $journey, bool $leaving, string $journey_id = self::N, string $visitor = self::V, int $user_id = 0 ): array {
		return array(
			'visitor'    => $visitor,
			'journey_id' => $journey_id,
			'journey'    => $journey,
			'steps'      => '' === $journey ? 0 : substr_count( $journey, '>' ) + 1,
			'user_id'    => $user_id,
			'data'       => array(),
			'leaving'    => $leaving,
		);
	}

	private function row( string $journey_id ): ?array {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . Journeys::table() . ' WHERE journey_id = %s', $journey_id ), ARRAY_A ); // phpcs:ignore WordPress.DB
		return is_array( $row ) ? $row : null;
	}

	private function journeys(): Journeys {
		return WPS::journeys();
	}

	public function test_the_table_exists_and_is_versioned(): void {
		global $wpdb;
		$this->assertSame( Journeys::DB_VERSION, WPS::instance()->config()->db_version() );
		$this->assertSame( Journeys::table(), $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', Journeys::table() ) ) ); // phpcs:ignore WordPress.DB
		$this->assertContains( 'ref', $wpdb->get_col( 'DESCRIBE ' . Journeys::table() ) ); // phpcs:ignore WordPress.DB
	}

	public function test_nothing_is_written_with_history_off(): void {
		update_option( 'wpsignal_history_enabled', false );
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false ) );
		$this->assertNull( $this->row( self::N ) );
	}

	public function test_reports_write_the_journey_with_the_extensions_record_and_a_shorter_report_never_shortens_it(): void {
		add_filter(
			'wpsignal_journey_record',
			static fn( array $record, array $report ): array => array(
				'ref'   => 'cart0001',
				'value' => 12.5,
			),
			10,
			2
		);
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:1200>post:5:300', false ) );
		$row = $this->row( self::N );
		$this->assertSame( 'home:1:1200>post:5:300', $row['journey'] );
		$this->assertSame( 'open', $row['outcome'] );
		$this->assertSame( 'cart0001', $row['ref'] );
		$this->assertSame( 12.5, (float) $row['value'] );
		$this->assertNull( $row['user_id'], 'a guest' );
		$this->assertNull( $row['ended_at'] );

		// The leave of the first page lands after the visit of the second: it never shortens the journey.
		do_action( 'wpsignal_visitor_leave', $this->report( 'home:1:1500', true ) );
		$row = $this->row( self::N );
		$this->assertSame( 'home:1:1200>post:5:300', $row['journey'] );
		$this->assertSame( 'open', $row['outcome'], 'a leave that is behind changes nothing' );

		// A leave at least as far along closes it.
		do_action( 'wpsignal_visitor_leave', $this->report( 'home:1:1200>post:5:9000', true ) );
		$row = $this->row( self::N );
		$this->assertSame( 'home:1:1200>post:5:9000', $row['journey'] );
		$this->assertSame( 'left', $row['outcome'] );
		$this->assertNotNull( $row['ended_at'] );

		// A report under another visitor id changes nothing on the row.
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:1>post:5:1>post:6:1', false, self::N, self::V2 ) );
		$this->assertSame( 'home:1:1200>post:5:9000', $this->row( self::N )['journey'] );
		$this->assertSame( self::V, $this->row( self::N )['visitor'] );
	}

	public function test_a_logged_in_visit_stamps_the_user_and_keeps_it_and_a_new_journey_ends_the_open_one(): void {
		$admins = get_users(
			array(
				'role'   => 'administrator',
				'number' => 1,
				'fields' => 'ID',
			)
		);
		$admin  = (int) $admins[0];
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false, self::N, self::V, $admin ) );
		$this->assertSame( $admin, (int) $this->row( self::N )['user_id'] );
		do_action( 'wpsignal_visitor_leave', $this->report( 'home:1:100>post:2:100', true, self::N, self::V, 0 ) );
		$this->assertSame( $admin, (int) $this->row( self::N )['user_id'], 'kept once set' );

		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false, self::N2 ) );
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false, self::N3 ) );
		$this->assertSame( 'left', $this->row( self::N2 )['outcome'], 'a new visit ends the visitor\'s other open journeys' );
		$this->assertNotNull( $this->row( self::N2 )['ended_at'] );
		$this->assertSame( 'open', $this->row( self::N3 )['outcome'] );
	}

	public function test_a_visitor_starts_at_most_thirty_journeys_an_hour(): void {
		global $wpdb;
		$now = gmdate( 'Y-m-d H:i:s' );
		for ( $i = 0; $i < 30; $i++ ) {
			$wpdb->insert(
				Journeys::table(),
				array(
					'journey_id' => sprintf( '%08x-0000-4000-8000-000000000000', $i ),
					'visitor'    => self::V,
					'journey'    => 'home:1:1',
					'steps'      => 1,
					'started_at' => $now,
					'last_seen'  => $now,
				)
			); // phpcs:ignore WordPress.DB
		}
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false ) );
		$this->assertNull( $this->row( self::N ), 'the thirty-first in an hour is refused' );
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false, self::N2, self::V2 ) );
		$this->assertNotNull( $this->row( self::N2 ), 'another visitor is not' );
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . Journeys::table() . ' WHERE visitor = %s', self::V ) ); // phpcs:ignore WordPress.DB
	}

	public function test_a_firing_is_appended_and_starts_the_row_when_it_comes_first_but_never_onto_another_visitors_row(): void {
		$firing = array(
			'visitor'    => self::V,
			'journey_id' => self::N,
			'rule_id'    => 'r1',
			'action'     => 'show',
			'step'       => 2,
			'ms'         => 4500,
			'kind'       => 'fired',
			'user_id'    => 0,
			'data'       => array(),
		);
		$this->journeys()->on_fired( $firing );
		$row = $this->row( self::N );
		$this->assertSame( '', $row['journey'], 'started empty, the next report fills it in' );
		$firings = json_decode( $row['firings'], true );
		$this->assertSame( 'r1', $firings[0]['rule'] );
		$this->assertSame( 4500, $firings[0]['ms'] );
		$this->assertSame( 'fired', $firings[0]['kind'] );

		$this->journeys()->on_fired( array( 'kind' => 'dismissed' ) + $firing );
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100>post:2:5000', false ) );
		$row     = $this->row( self::N );
		$firings = json_decode( $row['firings'], true );
		$this->assertCount( 2, $firings );
		$this->assertSame( 'dismissed', $firings[1]['kind'] );
		$this->assertSame( 'home:1:100>post:2:5000', $row['journey'] );

		$this->journeys()->on_fired( array( 'visitor' => self::V2 ) + $firing );
		$this->assertCount( 2, json_decode( $this->row( self::N )['firings'], true ), 'a firing under another visitor id reaches nothing' );
	}

	public function test_a_steps_time_is_bounded_and_its_digits_too(): void {
		global $wpdb;
		$now = gmdate( 'Y-m-d H:i:s' );
		$wpdb->insert(
			Journeys::table(),
			array(
				'journey_id' => self::N,
				'visitor'    => self::V,
				'journey'    => 'home:1:999999999>away:0:999999999>post:2:60000',
				'steps'      => 3,
				'started_at' => $now,
				'last_seen'  => $now,
			)
		); // phpcs:ignore WordPress.DB
		delete_transient( Journeys::VISUALS_TRANSIENT );
		$visuals = $this->journeys()->visuals();
		$minutes = 0;
		foreach ( $visuals['hours'] as $day ) {
			foreach ( $day as $cell ) {
				$minutes += $cell['minutes'];
			}
		}
		$this->assertSame( 1441, $minutes, 'a day at most for the eleven-day step, then one minute' );
		delete_transient( Journeys::VISUALS_TRANSIENT );
		list( $status ) = $this->rest(
			'POST',
			'visit',
			array(
				'v'       => self::V,
				'n'       => self::N2,
				'journey' => 'home:1:9999999999',
			)
		);
		$this->assertSame( 400, $status, 'ten digits of milliseconds is refused' );
	}

	public function test_an_extension_ends_journeys_by_ref_with_its_outcome_and_credits_the_firings_within_the_window(): void {
		$this->journeys()->outcome(
			'converted',
			array(
				'label'  => 'Order placed',
				'color'  => '#008300',
				'series' => 'Orders a day',
			)
		);
		add_filter( 'wpsignal_journey_record', static fn(): array => array( 'ref' => 'cart0001' ) );
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false ) );
		$this->journeys()->on_fired(
			array(
				'visitor'    => self::V,
				'journey_id' => self::N,
				'rule_id'    => 'r1',
				'action'     => 'show',
				'step'       => 0,
				'ms'         => 1,
				'kind'       => 'fired',
				'user_id'    => 0,
				'data'       => array(),
			)
		);
		do_action( 'wpsignal_visitor_visit', $this->report( 'cart:0:100', false, self::N2 ) );

		$this->assertSame( 0, $this->journeys()->end_by_ref( 'cart0001', 'bogus' ), 'an outcome nobody registered is refused' );
		$this->assertSame( 1, $this->journeys()->end_by_ref( 'cart0001', 'converted', 40.0, array( 'order' => 77 ) ), 'the open journey of the cart; the one already left stays left' );
		$this->assertSame( 'left', $this->row( self::N )['outcome'] );
		$this->assertSame( 'converted', $this->row( self::N2 )['outcome'] );
		$this->assertSame( 40.0, (float) $this->row( self::N2 )['value'] );
		$this->assertSame( array( 'order' => 77 ), json_decode( $this->row( self::N2 )['data'], true ), 'the data merged over the row\'s' );
		$this->assertNull( $this->row( self::N )['data'], 'the left journey\'s untouched' );
		$this->assertSame( 0, $this->journeys()->end_by_ref( 'cart0001', 'converted' ), 'nothing open is left' );
		// The thank-you page's report, the cart emptied: the converted journey keeps its value and data.
		add_filter(
			'wpsignal_journey_record',
			static fn(): array => array(
				'ref'   => 'cart0001',
				'value' => 0.0,
				'data'  => array( 'i' => array() ),
			),
			20
		);
		do_action( 'wpsignal_visitor_visit', $this->report( 'cart:0:100>thanks:0:0', false, self::N2 ) );
		$this->assertSame( 40.0, (float) $this->row( self::N2 )['value'] );
		$this->assertSame( array( 'order' => 77 ), json_decode( $this->row( self::N2 )['data'], true ) );
		$this->assertSame( 'cart:0:100>thanks:0:0', $this->row( self::N2 )['journey'], 'the journey itself still grows' );
		$answer = apply_filters( 'wpsignal_visitor_visit_response', array(), $this->report( 'cart:0:100>thanks:0:0', false, self::N2 ) );
		$this->assertSame( array( 'ended' => true ), $answer['journey'], 'and the browser is told to start a new one' );
		$this->assertArrayNotHasKey( 'journey', apply_filters( 'wpsignal_visitor_visit_response', array(), $this->report( 'home:1:100', false ) ), 'a journey merely left is not ended' );

		$this->assertSame( 1, $this->journeys()->credit( 'cart0001', 77, 40.0 ) );
		$firings = json_decode( $this->row( self::N )['firings'], true );
		$this->assertSame( 77, $firings[0]['order'] );
		$this->assertSame( 40.0, (float) $firings[0]['value'] );
		$this->assertSame( 0, $this->journeys()->credit( 'cart0001', 78, 1.0 ), 'a credited firing keeps its order' );

		remove_all_filters( 'wpsignal_journey_record' );
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false, self::N3 ) );
		$this->assertSame( 'converted', $this->row( self::N2 )['outcome'], 'a new visit never reopens an ended journey' );
		$this->assertNull( $this->row( self::N3 )['ref'], 'no extension said what it carries' );

		$this->assertSame( 2, $this->journeys()->erase_refs( array( 'cart0001', 'bad ref' ) ), 'the two rows with the ref; a malformed ref is ignored' );
		$this->assertNull( $this->row( self::N ) );
		$this->assertNotNull( $this->row( self::N3 ) );
	}

	public function test_the_feed_carries_the_extensions_context_and_the_routes_are_staff_only(): void {
		add_filter(
			'wpsignal_journey_record',
			static fn(): array => array(
				'ref'   => 'cart0001',
				'value' => 9.5,
				'data'  => array( 'items' => array( 7 => 2 ) ),
			)
		);
		add_filter( 'wpsignal_journey_context', static fn( array $context, array $row ): array => array( 'cart' => array( 'count' => '' === (string) $row['ref'] ? 0 : 1 ) ), 10, 2 );
		add_filter( 'wpsignal_journeys_currency', static fn(): string => 'EUR' );
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100>post:2:200', false ) );

		list( $status ) = $this->rest( 'GET', 'journeys' );
		$this->assertSame( 401, $status, 'visitors cannot read the journeys' );
		list( $status ) = $this->rest( 'GET', 'journeys/visuals' );
		$this->assertSame( 401, $status );

		$this->as_admin();
		list( $status, $data ) = $this->rest(
			'GET',
			'journeys',
			array(
				'days'  => 30,
				'limit' => 10,
			)
		);
		$this->assertSame( 200, $status );
		$this->assertTrue( $data['enabled'] );
		$this->assertSame( 'EUR', $data['currency'] );
		$mine = array_values( array_filter( $data['journeys'], static fn( array $j ): bool => 'home:1:100>post:2:200' === $j['journey'] ) );
		$this->assertCount( 1, $mine );
		$this->assertSame( 'open', $mine[0]['outcome'] );
		$this->assertSame( 9.5, $mine[0]['value'] );
		$this->assertTrue( $mine[0]['has_ref'] );
		$this->assertArrayNotHasKey( 'data', $mine[0], 'the data stays on the server; the context filter reads it from the row' );
		$this->assertSame( array( 'cart' => array( 'count' => 1 ) ), $mine[0]['context'] );
		$this->assertSame( array(), $mine[0]['firings'] );

		update_option( 'wpsignal_history_enabled', false );
		list( $status, $data ) = $this->rest( 'GET', 'journeys' );
		$this->assertSame( 200, $status );
		$this->assertFalse( $data['enabled'] );
		$this->assertSame( array(), $data['journeys'] );
		list( $status, $data ) = $this->rest( 'GET', 'journeys/visuals' );
		$this->assertSame( 200, $status );
		$this->assertNull( $data, 'history off' );
	}

	public function test_the_visuals_bucket_days_and_hours_on_the_site_clock_and_list_the_newest_journeys(): void {
		global $wpdb;
		$tz_before = get_option( 'timezone_string' );
		update_option( 'timezone_string', 'Pacific/Auckland' );
		$this->journeys()->outcome( 'converted', array( 'label' => 'Order placed' ) );
		$this->journeys()->ref(
			array(
				'label'       => 'Cart',
				'left_series' => 'Carts left behind a day',
			)
		);
		try {
			$tz     = new DateTimeZone( 'Pacific/Auckland' );
			$ten    = ( new DateTimeImmutable( 'today 10:00', $tz ) )->sub( new DateInterval( 'P2D' ) );
			$eleven = $ten->add( new DateInterval( 'PT1H' ) );
			$old    = $ten->sub( new DateInterval( 'P40D' ) );
			$utc    = static fn( DateTimeImmutable $at ): string => $at->setTimezone( new DateTimeZone( 'UTC' ) )->format( 'Y-m-d H:i:s' );
			$rows   = array(
				array( self::N, 'home:1:60000>post:5:1800000>away:0:600000>page:7:120000', 'left', 'cart0001', $utc( $ten ) ),
				array( self::N2, 'cart:0:1000>checkout:0:20000>thanks:0:1', 'converted', 'cart0002', $utc( $eleven ) ),
				array( self::N3, 'home:1:60000', 'left', null, $utc( $old ) ),
			);
			foreach ( $rows as list( $jid, $journey, $outcome, $ref, $started ) ) {
				$wpdb->insert(
					Journeys::table(),
					array(
						'journey_id' => $jid,
						'visitor'    => self::V,
						'ref'        => $ref,
						'journey'    => $journey,
						'steps'      => substr_count( $journey, '>' ) + 1,
						'outcome'    => $outcome,
						'started_at' => $started,
						'last_seen'  => $started,
					)
				); // phpcs:ignore WordPress.DB
			}
			delete_transient( Journeys::VISUALS_TRANSIENT );
			$visuals = $this->journeys()->visuals();
			$this->assertSame( 'Pacific/Auckland', $visuals['timezone'] );
			$this->assertSame( 2, $visuals['total'], 'the forty-day-old journey is outside the window' );
			$this->assertCount( 28, $visuals['days'] );
			$day = $visuals['days'][25];
			$this->assertSame( $ten->format( 'Y-m-d' ), $day['date'], 'the day before yesterday, on the site clock' );
			$this->assertSame( 2, $day['visits'] );
			$this->assertSame( 1, $day['left_ref'] );
			$this->assertSame(
				array(
					'left'      => 1,
					'converted' => 1,
				),
				$day['outcomes']
			);
			$w = (int) $ten->format( 'w' );
			$this->assertSame( 1, $visuals['hours'][ $w ][10]['visits'] );
			$this->assertSame( 33, $visuals['hours'][ $w ][10]['minutes'], 'one minute home, thirty on a post, two on a page; the away step adds nothing' );
			$this->assertSame( array( 'converted' => 1 ), $visuals['hours'][ $w ][11]['outcomes'] );
			$this->assertSame( 0, $visuals['hours'][ $w ][11]['minutes'], 'a twenty-second checkout rounds to no minutes' );
			$this->assertSame( 2, $visuals['listed'], 'the minutes came from the two journeys in the window' );
			$this->assertSame(
				array(
					'month' => $ten->format( 'Y-m' ),
					'count' => 2,
				),
				$visuals['months'][ $ten->format( 'Y-m' ) === $visuals['months'][0]['month'] ? 0 : 1 ],
				'the month of the two, on the site clock'
			);
			$this->assertContains(
				array(
					'month' => $old->format( 'Y-m' ),
					'count' => 1,
				),
				$visuals['months'],
				'the old journey is within the retention'
			);
			$page = $this->journeys()->visuals_page( $ten->format( 'Y-m' ), 1 );
			$this->assertSame( array( 'journeys' ), array_keys( $page ), 'the month count comes from the visuals' );
			$this->assertCount( 2, $page['journeys'], 'newest first' );
			$this->assertSame( 'converted', $page['journeys'][0]['outcome'] );
			$this->assertTrue( $page['journeys'][1]['has_ref'] );
			$this->assertSame( array(), $this->journeys()->visuals_page( $ten->format( 'Y-m' ), 2 )['journeys'], 'past the last page' );
			$this->assertNull( $this->journeys()->visuals_page( '2026-13', 1 ), 'not a month' );
			$this->assertSame( 'Order placed', $visuals['outcomes']['converted']['label'] );
			$this->assertSame( 'Left', $visuals['outcomes']['left']['label'] );
			$this->assertSame( 'Cart', $visuals['ref']['label'] );
			$this->assertSame( 'Home page', $visuals['kinds']['home'] );
				$this->assertSame( $visuals, $this->journeys()->visuals(), 'served from the cache' );
			delete_transient( Journeys::VISUALS_TRANSIENT );
		} finally {
			update_option( 'timezone_string', (string) $tz_before );
		}
	}

	public function test_prune_keeps_the_retention_and_empties_the_table_with_history_off(): void {
		global $wpdb;
		update_option( 'wpsignal_journeys_retention_months', 2 );
		$fresh = gmdate( 'Y-m-d H:i:s' );
		$stale = gmdate( 'Y-m-d H:i:s', strtotime( '-3 months' ) );
		foreach ( array(
			self::N  => $fresh,
			self::N2 => $stale,
		) as $jid => $started ) {
			$wpdb->insert(
				Journeys::table(),
				array(
					'journey_id' => $jid,
					'visitor'    => self::V,
					'journey'    => 'home:1:1',
					'steps'      => 1,
					'started_at' => $started,
					'last_seen'  => $started,
				)
			); // phpcs:ignore WordPress.DB
		}
		$this->journeys()->prune();
		$this->assertNotNull( $this->row( self::N ) );
		$this->assertNull( $this->row( self::N2 ), 'past two months' );
		update_option( 'wpsignal_history_enabled', false );
		$this->journeys()->prune();
		$this->assertNull( $this->row( self::N ), 'history off keeps nothing' );
	}

	public function test_the_privacy_tools_export_and_erase_a_users_journeys(): void {
		$admins = get_users(
			array(
				'role'   => 'administrator',
				'number' => 1,
			)
		);
		$admin  = $admins[0];
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false, self::N, self::V, (int) $admin->ID ) );
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false, self::N2, self::V2, 0 ) );
		$exporters = apply_filters( 'wp_privacy_personal_data_exporters', array() );
		$erasers   = apply_filters( 'wp_privacy_personal_data_erasers', array() );
		$this->assertArrayHasKey( 'wpsignal_journeys', $exporters );
		$export = call_user_func( $exporters['wpsignal_journeys']['callback'], $admin->user_email, 1 );
		$mine   = array_values( array_filter( $export['data'], static fn( array $item ): bool => 'wpsignal-journey-' . self::N === $item['item_id'] ) );
		$this->assertCount( 1, $mine );
		$this->assertSame( 'home:1:100', $mine[0]['data'][4]['value'] );
		$erased = call_user_func( $erasers['wpsignal_journeys']['callback'], $admin->user_email, 1 );
		$this->assertSame( 1, $erased['items_removed'] );
		$this->assertTrue( $erased['done'] );
		$this->assertNull( $this->row( self::N ) );
		$this->assertNotNull( $this->row( self::N2 ), 'a guest journey is nobody\'s' );
	}

	public function test_the_settings_routes_carry_the_history_fields(): void {
		$this->connect_site();
		$this->fake_http(
			static fn() => array(
				200,
				array(
					'active_connections' => 0,
					'max_connections'    => 50,
				),
			)
		);
		$this->as_admin();
		list( $status ) = $this->rest( 'POST', 'settings', array( 'journeys_retention_months' => 99 ) );
		$this->assertSame( 400, $status, 'the schema keeps the months between 1 and 36' );
		list( $status, $data ) = $this->rest(
			'POST',
			'settings',
			array(
				'history_enabled'           => false,
				'journeys_retention_months' => 24,
			)
		);
		$this->assertSame( 200, $status );
		$this->assertFalse( $data['history_enabled'] );
		$this->assertSame( 24, $data['journeys_retention_months'] );
		list( , $data ) = $this->rest( 'GET', 'settings' );
		$this->assertFalse( $data['history_enabled'] );
		$this->assertSame( 24, $data['journeys_retention_months'] );
		$this->assertArrayNotHasKey( 'firedUrl', WPS::rules()->config(), 'nothing listens and history is off' );
		update_option( 'wpsignal_history_enabled', true );
		$this->assertArrayHasKey( 'firedUrl', WPS::rules()->config(), 'history on: firings are stored' );
	}
}
