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
	private const N4 = 'af4a5b6c-7d8e-4f90-b1a2-3d4e5f607182';
	private const N5 = 'b05b6c7d-8e9f-4a01-82b3-4e5f60718293';

	protected function setUp(): void {
		parent::setUp();
		$this->clear();
		Journeys::reset_kind_codes();
		update_option( 'wpsignal_history_enabled', true );
		delete_transient( Journeys::VISUALS_TRANSIENT );
	}

	protected function tearDown(): void {
		$this->clear();
		remove_all_filters( 'wpsignal_journey_record' );
		remove_all_filters( 'wpsignal_journey_context' );
		remove_all_filters( 'wpsignal_journeys_currency' );
		Journeys::reset_kind_codes();
		parent::tearDown();
	}

	/** Every row the tests wrote: their visitors are the two constants. */
	private function clear(): void {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . Journeys::table() . ' WHERE visitor IN (UNHEX(%s), UNHEX(%s))', Journeys::hex( self::V ), Journeys::hex( self::V2 ) ) ); // phpcs:ignore WordPress.DB
	}

	/** A journey as the row stores it. */
	private function stored( string $journey ): string {
		return Journeys::pack_journey( $journey );
	}

	/** A row written as given, ids as UUIDs and the journey in kind names. */
	private function insert( array $row ): void {
		$this->assertTrue( Journeys::insert_row( $row ), 'the row was written' );
	}

	/** A report as the visit and leave routes hand it to the actions. */
	private function report( string $journey, bool $leaving, string $journey_id = self::N, string $visitor = self::V, int $user_id = 0, int $ago = 0 ): array {
		return array(
			'visitor'    => $visitor,
			'journey_id' => $journey_id,
			'journey'    => $journey,
			'steps'      => '' === $journey ? 0 : substr_count( $journey, '>' ) + 1,
			'user_id'    => $user_id,
			'data'       => array(),
			'leaving'    => $leaving,
			'ago'        => $ago,
		);
	}

	/** Date a row's last report past the gap, so the visitor's next journey finds it unreported. */
	private function age( string $journey_id ): void {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . Journeys::table() . ' SET last_seen = %s WHERE journey_id = UNHEX(%s)', gmdate( 'Y-m-d H:i:s', time() - Journeys::GAP_SECONDS - 60 ), Journeys::hex( $journey_id ) ) ); // phpcs:ignore WordPress.DB
	}

	/** The row as stored, `journey_id` and `visitor` as UUIDs; the journey stays in its stored form. */
	private function row( string $journey_id ): ?array {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT *, HEX(journey_id) AS journey_hex, HEX(visitor) AS visitor_hex FROM ' . Journeys::table() . ' WHERE journey_id = UNHEX(%s)', Journeys::hex( $journey_id ) ), ARRAY_A ); // phpcs:ignore WordPress.DB
		if ( ! is_array( $row ) ) {
			return null;
		}
		$row['journey_id'] = Journeys::uuid( (string) $row['journey_hex'] );
		$row['visitor']    = Journeys::uuid( (string) $row['visitor_hex'] );
		unset( $row['journey_hex'], $row['visitor_hex'] );
		return $row;
	}

	/** A row's firings in the named shape. */
	private function firings_of( string $journey_id ): array {
		return Journeys::unpack_firings( $this->row( $journey_id )['firings'] ?? null );
	}

	private function journeys(): Journeys {
		return WPS::journeys();
	}

	public function test_the_table_exists_and_is_versioned(): void {
		global $wpdb;
		$this->assertSame( Journeys::DB_VERSION, WPS::instance()->config()->db_version() );
		$this->assertSame( Journeys::table(), $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', Journeys::table() ) ) ); // phpcs:ignore WordPress.DB
		$columns = array_column( (array) $wpdb->get_results( 'DESCRIBE ' . Journeys::table(), ARRAY_A ), 'Type', 'Field' ); // phpcs:ignore WordPress.DB
		$this->assertArrayHasKey( 'ref', $columns );
		$this->assertArrayNotHasKey( 'ended_at', $columns, 'outcome says whether a journey ended, last_seen when' );
		$this->assertSame( 'binary(16)', $columns['journey_id'] );
		$this->assertSame( 'binary(16)', $columns['visitor'] );
		$this->assertStringStartsWith( 'bigint', $columns['id'] );
		$indexes = array_unique( array_column( (array) $wpdb->get_results( 'SHOW INDEX FROM ' . Journeys::table(), ARRAY_A ), 'Key_name' ) ); // phpcs:ignore WordPress.DB
		$this->assertEqualsCanonicalizing( array( 'PRIMARY', 'journey_id', 'visitor_started', 'user_id', 'ref', 'started_at', 'last_seen' ), array_values( $indexes ), 'no index on outcome, none on visitor alone' );
	}

	public function test_a_version_from_four_on_adds_what_is_missing_without_dropping_the_rows(): void {
		global $wpdb;
		$table = Journeys::table();
		$this->insert( array( 'journey_id' => self::N, 'visitor' => self::V, 'journey' => 'home:0:5' ) );
		$wpdb->query( "ALTER TABLE {$table} DROP INDEX last_seen" ); // phpcs:ignore WordPress.DB
		WPS::instance()->config()->save_db_version( Journeys::DB_REBUILD_BELOW );

		$this->journeys()->install();

		$indexes = array_column( (array) $wpdb->get_results( "SHOW INDEX FROM {$table}", ARRAY_A ), 'Key_name' ); // phpcs:ignore WordPress.DB
		$this->assertContains( 'last_seen', $indexes, 'the index is added in place' );
		$this->assertNotNull( $this->row( self::N ), 'the rows stay' );
		$this->assertSame( Journeys::DB_VERSION, WPS::instance()->config()->db_version() );
	}

	public function test_ids_are_stored_as_bytes_and_kinds_as_codes_that_read_back_as_names(): void {
		global $wpdb;
		$post = (int) wp_insert_post(
			array(
				'post_title'  => 'Codec fixture',
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		$term = wp_insert_term( 'Codec fixture ' . wp_generate_password( 6, false ), 'category' );
		$term = is_array( $term ) ? (int) $term['term_id'] : 0;
		add_filter( 'wpsignal_kind_codes', static fn( array $codes ): array => $codes + array( 'wps_thing' => 'wt', 'wps_clash' => 'h', 'wps_short' => 'q' ) );
		try {
			$journey = "home:1:10>post:{$post}:20>category:{$term}:30>post_archive:0:5>wps_thing:3:1>wps_clash:0:1>wps_short:0:1>admin:0:2>away:0:4";
			do_action( 'wpsignal_visitor_visit', $this->report( $journey, false ) );
			$row = $this->row( self::N );
			$this->assertNotNull( $row, 'the row was written' );
			$this->assertSame( "h:1:10>p:{$post}:20>t:{$term}:30>post_a:0:5>wt:3:1>wps_clash:0:1>wps_short:0:1>ad:0:2>w:0:4", $row['journey'], 'codes in the row; a code already WordSocket\'s or of one letter leaves the kind by name' );
			$this->assertSame( self::N, $row['journey_id'] );
			$this->assertSame( self::V, $row['visitor'] );
			$this->assertSame( 32, strlen( (string) $wpdb->get_var( $wpdb->prepare( 'SELECT HEX(journey_id) FROM ' . Journeys::table() . ' WHERE journey_id = UNHEX(%s)', Journeys::hex( self::N ) ) ) ), '16 bytes' ); // phpcs:ignore WordPress.DB
			$feed = array_values( array_filter( $this->journeys()->feed( 1, 100 ), static fn( array $j ): bool => str_starts_with( $j['journey'], 'home:1:10>' ) ) );
			$this->assertSame( $journey, $feed[0]['journey'], 'names again on the way out' );
			wp_delete_post( $post, true );
			wp_delete_term( $term, 'category' );
			$feed = array_values( array_filter( $this->journeys()->feed( 1, 100 ), static fn( array $j ): bool => str_starts_with( $j['journey'], 'home:1:10>' ) ) );
			$this->assertSame( "home:1:10>deleted:{$post}:20>deleted:{$term}:30>post_archive:0:5>wps_thing:3:1>wps_clash:0:1>wps_short:0:1>admin:0:2>away:0:4", $feed[0]['journey'], 'a post or term that is gone reads as deleted' );
			$this->assertSame( 'tag', Journeys::taxonomy_kind( 'post_tag' ) );
			$this->assertSame( '', Journeys::hex( 'not-a-uuid' ) );
			$this->assertSame( self::N, Journeys::uuid( strtoupper( Journeys::hex( self::N ) ) ) );
			$this->assertFalse( Journeys::insert_row( array( 'journey_id' => 'nope', 'visitor' => self::V ) ), 'an id that is not a UUID is refused' );
		} finally {
			remove_all_filters( 'wpsignal_kind_codes' );
			wp_delete_post( $post, true );
			if ( $term ) {
				wp_delete_term( $term, 'category' );
			}
		}
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
		$this->assertSame( $this->stored( 'home:1:1200>post:5:300' ), $row['journey'] );
		$this->assertSame( 'open', $row['outcome'] );
		$this->assertSame( 'cart0001', $row['ref'] );
		$this->assertSame( 12.5, (float) $row['value'] );
		$this->assertNull( $row['user_id'], 'a guest' );

		// The leave of the first page lands after the visit of the second: it never shortens the journey.
		do_action( 'wpsignal_visitor_leave', $this->report( 'home:1:1500', true ) );
		$row = $this->row( self::N );
		$this->assertSame( $this->stored( 'home:1:1200>post:5:300' ), $row['journey'] );
		$this->assertSame( 'open', $row['outcome'], 'a leave that is behind changes nothing' );

		// A leave at least as far along closes it.
		do_action( 'wpsignal_visitor_leave', $this->report( 'home:1:1200>post:5:9000', true ) );
		$row = $this->row( self::N );
		$this->assertSame( $this->stored( 'home:1:1200>post:5:9000' ), $row['journey'] );
		$this->assertSame( 'left', $row['outcome'] );

		// A report under another visitor id changes nothing on the row.
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:1>post:5:1>post:6:1', false, self::N, self::V2 ) );
		$this->assertSame( $this->stored( 'home:1:1200>post:5:9000' ), $this->row( self::N )['journey'] );
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

		// A journey heard from within the gap may be another live tab's: a new journey leaves it open.
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false, self::N2 ) );
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false, self::N3 ) );
		$this->assertSame( 'open', $this->row( self::N2 )['outcome'], 'two tabs, two open journeys' );
		$this->assertSame( 'open', $this->row( self::N3 )['outcome'] );

		// One unreported for longer than the gap cannot go on, so the next journey marks it.
		$this->age( self::N2 );
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false, self::N4 ) );
		$this->assertSame( 'incomplete', $this->row( self::N2 )['outcome'], 'a new visit marks the visitor\'s open journeys past the gap incomplete, since nobody saw them end' );
		$this->assertSame( 'open', $this->row( self::N3 )['outcome'], 'heard from a moment ago' );
		$this->assertSame( 'open', $this->row( self::N4 )['outcome'] );
	}

	public function test_a_late_leave_is_dated_by_how_long_ago_it_happened_and_the_prune_marks_stale_open_journeys_incomplete(): void {
		$two_days_ago = gmdate( 'Y-m-d H:i:s', time() - 2 * DAY_IN_SECONDS );
		$this->insert(
			array(
				'journey_id' => self::N,
				'visitor'    => self::V,
				'journey'    => 'home:1:40>away:0:0',
				'outcome'    => 'open',
				'started_at' => $two_days_ago,
				'last_seen'  => $two_days_ago,
			)
		);
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:0', false, self::N2, self::V2 ) );
		$this->journeys()->prune();
		$this->assertSame( 'incomplete', $this->row( self::N )['outcome'], 'open for two days with nothing heard' );
		$this->assertSame( 'open', $this->row( self::N2 )['outcome'], 'a journey reported a moment ago stays open' );
		$this->assertArrayNotHasKey( 'journey', apply_filters( 'wpsignal_visitor_visit_response', array(), $this->report( 'home:1:40>away:0:0', false ) ), 'incomplete is not final' );
		$this->assertSame( 'Incomplete', $this->journeys()->outcomes()['incomplete']['label'] );

		// The browser is back and sends the leave it never got to, twenty minutes after the journey ended.
		do_action( 'wpsignal_visitor_leave', $this->report( 'home:1:40>away:0:1800', true, self::N, self::V, 0, 1200 ) );
		$row = $this->row( self::N );
		$this->assertSame( 'left', $row['outcome'], 'a leave that arrives is a leave' );
		$this->assertSame( $this->stored( 'home:1:40>away:0:1800' ), $row['journey'] );
		$ago = time() - strtotime( $row['last_seen'] . ' UTC' );
		$this->assertGreaterThanOrEqual( 1195, $ago, 'last seen is when the report says, not when it arrived' );
		$this->assertLessThanOrEqual( 1215, $ago );
	}

	public function test_a_report_that_creates_a_row_dates_its_start_by_the_journey_it_carries(): void {
		// The outbox: a leave for a journey WordPress never heard of, sent twenty minutes after it ended.
		do_action( 'wpsignal_visitor_leave', $this->report( 'home:1:40>product:7:60>away:0:1800', true, self::N, self::V, 0, 1200 ) );
		$row       = $this->row( self::N );
		$last_seen = strtotime( $row['last_seen'] . ' UTC' );
		$started   = strtotime( $row['started_at'] . ' UTC' );
		$this->assertEqualsWithDelta( time() - 1200, $last_seen, 10, 'last seen is when the leave says it happened' );
		$this->assertSame( 1900, $last_seen - $started, 'the start is the end less the steps' );
		$this->assertSame( 1900, Journeys::duration( 'home:1:40>product:7:60>away:0:1800' ) );
		$this->assertSame( 0, Journeys::duration( '' ) );
		$this->assertSame( Journeys::MAX_STEP_SECONDS + 5, Journeys::duration( 'home:1:999999>post:2:5' ), 'a step counts for a day at most' );

		// A live first report with no history behind it: started now, as before.
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:0', false, self::N2, self::V2 ) );
		$row = $this->row( self::N2 );
		$this->assertEqualsWithDelta( time(), strtotime( $row['started_at'] . ' UTC' ), 10 );
		// A later report never moves the start.
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:30>post:2:5', false, self::N2, self::V2 ) );
		$this->assertSame( $row['started_at'], $this->row( self::N2 )['started_at'] );
	}

	public function test_a_visitor_starts_at_most_thirty_journeys_an_hour(): void {
		global $wpdb;
		$now = gmdate( 'Y-m-d H:i:s' );
		for ( $i = 0; $i < 30; $i++ ) {
			$this->insert(
				array(
					'journey_id' => sprintf( '%08x-0000-4000-8000-000000000000', $i ),
					'visitor'    => self::V,
					'journey'    => 'home:1:1',
					'started_at' => $now,
				)
			);
		}
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false ) );
		$this->assertNull( $this->row( self::N ), 'the thirty-first in an hour is refused' );
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false, self::N2, self::V2 ) );
		$this->assertNotNull( $this->row( self::N2 ), 'another visitor is not' );
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . Journeys::table() . ' WHERE visitor = UNHEX(%s)', Journeys::hex( self::V ) ) ); // phpcs:ignore WordPress.DB
	}

	public function test_a_firing_is_appended_and_starts_the_row_when_it_comes_first_but_never_onto_another_visitors_row(): void {
		$firing = array(
			'visitor'    => self::V,
			'journey_id' => self::N,
			'rule_id'    => 'r1',
			'action'     => 'show',
			'step'       => 2,
			's'          => 4,
			'kind'       => 'fired',
			'user_id'    => 0,
			'data'       => array(),
		);
		$this->journeys()->on_fired( $firing );
		$row = $this->row( self::N );
		$this->assertSame( '', $row['journey'], 'started empty, the next report fills it in' );
		$this->assertSame( array( 'r1', 'show', 2, 4, 0 ), array_slice( json_decode( $row['firings'], true )['f'][0], 0, 5 ), 'a tuple: rule, action, step, seconds, kind 0 for fired' );
		$firings = $this->firings_of( self::N );
		$this->assertSame( 'r1', $firings[0]['rule'] );
		$this->assertSame( 4, $firings[0]['s'] );
		$this->assertSame( 'fired', $firings[0]['kind'] );
		$this->assertMatchesRegularExpression( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $firings[0]['at'] );

		$this->journeys()->on_fired( array( 'kind' => 'dismissed' ) + $firing );
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100>post:2:5000', false ) );
		$row     = $this->row( self::N );
		$firings = $this->firings_of( self::N );
		$this->assertCount( 2, $firings );
		$this->assertSame( 'dismissed', $firings[1]['kind'] );
		$this->assertSame( $this->stored( 'home:1:100>post:2:5000' ), $row['journey'] );

		$this->journeys()->on_fired( array( 'visitor' => self::V2 ) + $firing );
		$this->assertCount( 2, $this->firings_of( self::N ), 'a firing under another visitor id reaches nothing' );
	}

	public function test_a_steps_time_is_bounded_and_its_digits_too(): void {
		global $wpdb;
		$now = gmdate( 'Y-m-d H:i:s' );
		$this->insert(
			array(
				'journey_id' => self::N,
				'visitor'    => self::V,
				'journey'    => 'home:1:999999>away:0:999999>post:2:60',
				'started_at' => $now,
			)
		);
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
				'journey' => 'home:1:9999999',
			)
		);
		$this->assertSame( 400, $status, 'seven digits of seconds is refused' );
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
				's'          => 1,
				'kind'       => 'fired',
				'user_id'    => 0,
				'data'       => array(),
			)
		);
		$this->age( self::N );
		do_action( 'wpsignal_visitor_visit', $this->report( 'cart:0:100', false, self::N2 ) );

		$this->assertSame( 0, $this->journeys()->end_by_ref( 'cart0001', 'bogus' ), 'an outcome nobody registered is refused' );
		$this->assertSame( 1, $this->journeys()->end_by_ref( 'cart0001', 'converted', 40.0, array( 'order' => 77 ) ), 'the open journey of the cart; the one marked incomplete stays so' );
		$this->assertSame( 'incomplete', $this->row( self::N )['outcome'] );
		$this->assertSame( 'converted', $this->row( self::N2 )['outcome'] );
		$this->assertSame( 40.0, (float) $this->row( self::N2 )['value'] );
		$this->assertSame( array( 'order' => 77 ), json_decode( $this->row( self::N2 )['data'], true ), 'the data merged over the row\'s' );
		$this->assertNull( $this->row( self::N )['data'], 'the incomplete journey\'s untouched' );
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
		$this->assertSame( $this->stored( 'cart:0:100>thanks:0:0' ), $this->row( self::N2 )['journey'], 'the journey itself still grows' );
		$answer = apply_filters( 'wpsignal_visitor_visit_response', array(), $this->report( 'cart:0:100>thanks:0:0', false, self::N2 ) );
		$this->assertSame( array( 'ended' => true ), $answer['journey'], 'and the browser is told to start a new one' );
		$this->assertArrayNotHasKey( 'journey', apply_filters( 'wpsignal_visitor_visit_response', array(), $this->report( 'home:1:100', false ) ), 'a journey merely left is not ended' );

		$this->assertSame( 1, $this->journeys()->credit( 'cart0001', 77, 40.0 ) );
		$stored = json_decode( $this->row( self::N )['firings'], true );
		$this->assertSame( 77, $stored['o']['id'], 'the order once on the row' );
		$this->assertSame( 40.0, (float) $stored['o']['v'] );
		$firings = $this->firings_of( self::N );
		$this->assertSame( 77, $firings[0]['order'] );
		$this->assertSame( 40.0, (float) $firings[0]['value'] );
		$this->assertArrayHasKey( 'order_at', $firings[0] );
		$this->assertSame( 0, $this->journeys()->credit( 'cart0001', 78, 1.0 ), 'a credited row keeps its order' );

		remove_all_filters( 'wpsignal_journey_record' );
		do_action( 'wpsignal_visitor_visit', $this->report( 'home:1:100', false, self::N3 ) );
		$this->assertSame( 'converted', $this->row( self::N2 )['outcome'], 'a new visit never reopens an ended journey' );
		$this->assertNull( $this->row( self::N3 )['ref'], 'no extension said what it carries' );

		$this->assertSame( 2, $this->journeys()->erase_refs( array( 'cart0001', 'bad ref' ) ), 'the two rows with the ref; a malformed ref is ignored' );
		$this->assertNull( $this->row( self::N ) );
		$this->assertNotNull( $this->row( self::N3 ) );
	}

	public function test_query_lists_records_newest_first_with_filters_and_the_download_formats_them(): void {
		$earlier = gmdate( 'Y-m-d H:i:s', time() - HOUR_IN_SECONDS );
		$now     = gmdate( 'Y-m-d H:i:s' );
		$this->insert(
			array(
				'journey_id' => self::N,
				'visitor'    => self::V,
				'journey'    => 'home:1:4>search:0:9',
				'outcome'    => 'left',
				'ref'        => 'qry-ref',
				'value'      => 10.5,
				'started_at' => $earlier,
				'last_seen'  => $earlier,
			)
		);
		$this->insert(
			array(
				'journey_id' => self::N2,
				'visitor'    => self::V2,
				'journey'    => 'home:1:2',
				'outcome'    => 'open',
				'ref'        => 'qry-ref',
				'started_at' => $now,
				'last_seen'  => $now,
			)
		);
		$records = Journeys::query( array( 'ref' => 'qry-ref' ) );
		$this->assertCount( 2, $records );
		$this->assertSame( self::N2, $records[0]['journey_id'], 'newest first' );
		$this->assertSame( array_keys( Journeys::legend() ), array_keys( $records[0] ) );
		$this->assertSame( self::V, $records[1]['visitor'] );
		$this->assertSame( 'home > search', $records[1]['path'] );
		$this->assertSame( 10.5, $records[1]['value'] );
		$this->assertNull( $records[0]['value'] );
		$this->assertNull( $records[0]['data'] );
		$this->assertSame( array(), $records[0]['firings'] );
		$this->assertMatchesRegularExpression( '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/', $records[0]['started_at'] );
		$this->assertSame( 2, Journeys::query_count( array( 'ref' => 'qry-ref' ) ) );
		$this->assertSame( array( self::N ), array_column( Journeys::query( array( 'ref' => 'qry-ref', 'outcome' => 'left' ) ), 'journey_id' ) );
		$this->assertSame( array( self::N2 ), array_column( Journeys::query( array( 'visitor' => self::V2 ) ), 'journey_id' ) );
		$this->assertSame( array( self::N2 ), array_column( Journeys::query( array( 'ref' => 'qry-ref', 'limit' => 1 ) ), 'journey_id' ) );
		$this->assertSame( array( self::N ), array_column( Journeys::query( array( 'ref' => 'qry-ref', 'exclude_visitor_prefix' => substr( self::V2, 0, 9 ) ) ), 'journey_id' ), 'a visitor prefix leaves those rows out' );
		$this->assertInstanceOf( WP_Error::class, Journeys::query( array( 'exclude_visitor_prefix' => 'seed' ) ), 'a prefix must be hex digits' );
		$rows = Journeys::query_rows( array( 'ref' => 'qry-ref' ) );
		$this->assertSame( 'h:1:4>s:0:9', $rows[1]['journey'], 'a row keeps the stored kind codes' );
		$this->assertSame( strtoupper( Journeys::hex( self::V ) ), $rows[1]['visitor'], 'and its ids as hex' );
		$this->assertInstanceOf( WP_Error::class, Journeys::query( array( 'visitor' => 'nope' ) ) );
		$this->assertInstanceOf( WP_Error::class, Journeys::query( array( 'days' => 0 ) ) );
		$this->assertInstanceOf( WP_Error::class, Journeys::query( array( 'limit' => Journeys::QUERY_MAX_LIMIT + 1 ) ) );

		$csv = $this->journeys()->download( 'csv', array( 'ref' => 'qry-ref' ) );
		$this->assertStringEndsWith( '.csv', $csv['filename'] );
		$this->assertSame( 'text/csv', $csv['type'] );
		$lines = array_values( array_filter( explode( "\n", $this->written( $csv ) ) ) );
		$this->assertCount( 3, $lines, 'a header and two rows' );
		$this->assertSame( array_keys( Journeys::legend() ), str_getcsv( $lines[0], ',', '"', '' ) );
		$this->assertSame( self::N2, str_getcsv( $lines[1], ',', '"', '' )[0] );
		$this->assertSame( '', str_getcsv( $lines[1], ',', '"', '' )[5], 'no value reads as empty' );
		$json = $this->journeys()->download( 'json', array( 'ref' => 'qry-ref' ) );
		$this->assertSame( 'application/json', $json['type'] );
		$decoded = json_decode( $this->written( $json ), true );
		$this->assertSame( array( 'site', 'exported_at', 'days', 'count', 'currency', 'legend', 'journeys' ), array_keys( $decoded ) );
		$this->assertSame( 2, $decoded['count'] );
		$this->assertSame( Journeys::legend(), $decoded['legend'] );
		$this->assertSame( self::N2, $decoded['journeys'][0]['journey_id'] );
		$this->assertInstanceOf( WP_Error::class, $this->journeys()->download( 'xml' ) );
		$this->assertSame( 10, has_action( 'admin_post_' . Journeys::DOWNLOAD_ACTION, array( $this->journeys(), 'handle_download' ) ) );
		$this->assertStringContainsString( 'action=' . Journeys::DOWNLOAD_ACTION . '&_wpnonce=', Journeys::download_url() );
	}

	public function test_the_csv_streams_every_row_a_page_at_a_time(): void {
		$now = gmdate( 'Y-m-d H:i:s' );
		foreach ( array( self::N, self::N2, self::N3 ) as $i => $id ) {
			$this->insert(
				array(
					'journey_id' => $id,
					'visitor'    => self::V,
					'journey'    => 'home:1:' . ( $i + 1 ),
					'outcome'    => 'left',
					'ref'        => 'page-ref',
					'started_at' => $now,
					'last_seen'  => $now,
				)
			);
		}
		$ids = array_column( iterator_to_array( Journeys::query_all( array( 'ref' => 'page-ref' ), 2 ), false ), 'journey_id' );
		$this->assertSame( array( self::N3, self::N2, self::N ), $ids, 'three rows in one second cross a page of two through the id cursor, newest first' );
		$this->assertSame( $ids, array_column( Journeys::query( array( 'ref' => 'page-ref' ) ), 'journey_id' ), 'the same order as one page' );
		$this->assertInstanceOf( WP_Error::class, Journeys::query_all( array( 'days' => 0 ) ) );
		$this->assertInstanceOf( WP_Error::class, $this->journeys()->download( 'csv', array( 'days' => 0 ) ) );
		$lines = array_values( array_filter( explode( "\n", $this->written( $this->journeys()->download( 'csv', array( 'ref' => 'page-ref' ) ) ) ) ) );
		$this->assertCount( 4, $lines, 'a header and every row' );
		$this->assertStringStartsWith( self::N3, $lines[1] );
	}

	/** What a download writes, as a string. */
	private function written( array $file ): string {
		$out = fopen( 'php://memory', 'r+' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen
		$file['write']( $out );
		rewind( $out );
		$body = (string) stream_get_contents( $out );
		fclose( $out ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
		return $body;
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
		$post    = (int) wp_insert_post(
			array(
				'post_title'  => 'Feed fixture',
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		$journey = "home:1:100>post:{$post}:200";
		do_action( 'wpsignal_visitor_visit', $this->report( $journey, false ) );

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
		$mine = array_values( array_filter( $data['journeys'], static fn( array $j ): bool => $journey === $j['journey'] ) );
		$this->assertCount( 1, $mine, 'the journey reads back in kind names' );
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
		$mine = array_values( array_filter( $data['journeys'], static fn( array $j ): bool => $journey === $j['journey'] ) );
		$this->assertCount( 1, $mine, 'history off keeps what was kept readable' );
		list( $status, $data ) = $this->rest( 'GET', 'journeys/visuals' );
		$this->assertSame( 200, $status );
		$this->assertIsArray( $data, 'history off still draws what was kept' );
		$this->assertGreaterThanOrEqual( 1, $data['total'] );
		wp_delete_post( $post, true );
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
				array( self::N, 'home:1:60>post:5:1800>away:0:600>page:7:120', 'left', 'cart0001', $utc( $ten ) ),
				array( self::N2, 'cart:0:1>checkout:0:20>thanks:0:1', 'converted', 'cart0002', $utc( $eleven ) ),
				array( self::N3, 'home:1:60', 'left', null, $utc( $old ) ),
			);
			foreach ( $rows as list( $jid, $journey, $outcome, $ref, $started ) ) {
				$this->insert(
					array(
						'journey_id' => $jid,
						'visitor'    => self::V,
						'ref'        => $ref,
						'journey'    => $journey,
						'outcome'    => $outcome,
						'started_at' => $started,
					)
				);
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
			$this->assertGreaterThan( 0, $visuals['storage']['bytes'], 'the table takes room on disk' );
			$this->assertSame( 3, $visuals['storage']['rows'], 'every journey within the retention, in the window or not' );
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
			// A journey since: the kept answer does not know it, a fresh one does and is kept in its place.
			$this->insert(
				array(
					'journey_id' => self::N4,
					'visitor'    => self::V,
					'journey'    => 'home:1:30',
					'outcome'    => 'left',
					'started_at' => $utc( $eleven ),
				)
			);
			$this->assertSame( $visuals['total'], $this->journeys()->visuals()['total'] );
			$this->assertSame( $visuals['total'] + 1, $this->journeys()->visuals( true )['total'] );
			$this->assertSame( $visuals['total'] + 1, $this->journeys()->visuals()['total'], 'the fresh answer is the one kept' );
			$this->as_admin();
			delete_transient( Journeys::VISUALS_TRANSIENT );
			list( , $kept ) = $this->rest( 'GET', 'journeys/visuals' );
			$this->insert(
				array(
					'journey_id' => self::N5,
					'visitor'    => self::V,
					'journey'    => 'home:1:30',
					'outcome'    => 'left',
					'started_at' => $utc( $eleven ),
				)
			);
			list( , $asked ) = $this->rest( 'GET', 'journeys/visuals', array( 'fresh' => true ) );
			$this->assertSame( $kept['total'] + 1, $asked['total'], 'the route computes again when asked' );
			delete_transient( Journeys::VISUALS_TRANSIENT );
		} finally {
			update_option( 'timezone_string', (string) $tz_before );
		}
	}

	public function test_prune_keeps_the_retention_whether_history_is_on_or_off(): void {
		global $wpdb;
		update_option( 'wpsignal_journeys_retention_months', 2 );
		$fresh = gmdate( 'Y-m-d H:i:s' );
		$stale = gmdate( 'Y-m-d H:i:s', strtotime( '-3 months' ) );
		foreach ( array(
			self::N  => $fresh,
			self::N2 => $stale,
		) as $jid => $started ) {
			$this->insert(
				array(
					'journey_id' => $jid,
					'visitor'    => self::V,
					'journey'    => 'home:1:1',
					'started_at' => $started,
				)
			);
		}
		$this->journeys()->prune();
		$this->assertNotNull( $this->row( self::N ) );
		$this->assertNull( $this->row( self::N2 ), 'past two months' );
		update_option( 'wpsignal_history_enabled', false );
		$this->journeys()->prune();
		$this->assertNotNull( $this->row( self::N ), 'history off keeps what is within the retention' );
	}

	public function test_purge_deletes_the_days_asked_on_the_site_clock_and_the_route_is_staff_only(): void {
		global $wpdb;
		$timezone = get_option( 'timezone_string' );
		update_option( 'timezone_string', 'America/New_York' );
		try {
			foreach ( array(
				self::N  => '2001-10-15 02:00:00',
				self::N2 => '2001-10-15 12:00:00',
				self::N3 => '2001-10-17 12:00:00',
			) as $jid => $started ) {
				$this->insert(
					array(
						'journey_id' => $jid,
						'visitor'    => self::V,
						'journey'    => 'home:1:1',
						'started_at' => $started,
					)
				);
			}
			$this->assertSame( 1, $this->journeys()->count( '2001-10-15', '2001-10-15' ), '02:00 UTC is still the 14th in New York' );
			$this->assertSame( 2, $this->journeys()->count( null, '2001-10-15' ) );
			$this->assertTrue( Journeys::is_date( '2026-02-28' ) );
			$this->assertFalse( Journeys::is_date( '2026-02-30' ), 'a day the month lacks' );
			$this->assertFalse( Journeys::is_date( '2001-10-15T00:00' ) );

			list( $status ) = $this->rest( 'DELETE', 'journeys' );
			$this->assertSame( 401, $status, 'visitors cannot delete' );
			$this->assertNotNull( $this->row( self::N ) );

			$this->as_admin();
			list( $status ) = $this->rest(
				'DELETE',
				'journeys',
				array(
					'from' => '2001-10-16',
					'to'   => '2001-10-15',
				)
			);
			$this->assertSame( 400, $status, 'the first day after the last' );
			list( $status ) = $this->rest( 'DELETE', 'journeys', array( 'from' => '2001-13-01' ) );
			$this->assertSame( 400, $status, 'not a day' );
			$this->assertNotNull( $this->row( self::N2 ), 'a refused request deletes nothing' );

			list( $status, $data ) = $this->rest(
				'DELETE',
				'journeys',
				array(
					'from' => '2001-10-15',
					'to'   => '2001-10-15',
				)
			);
			$this->assertSame( 200, $status );
			$this->assertSame( 1, $data['deleted'] );
			$this->assertGreaterThan( 0, Journeys::storage_bytes(), 'the table is rebuilt after a purge and still reads' );
			$this->assertNotNull( $this->row( self::N ), 'the 14th in New York stays' );
			$this->assertNull( $this->row( self::N2 ) );
			$this->assertNotNull( $this->row( self::N3 ) );

			list( $status, $data ) = $this->rest( 'DELETE', 'journeys', array( 'from' => '2001-10-16' ) );
			$this->assertSame( 200, $status );
			$this->assertSame( 1, $data['deleted'] );
			$this->assertNull( $this->row( self::N3 ) );
			$this->assertNotNull( $this->row( self::N ) );
		} finally {
			update_option( 'timezone_string', $timezone );
		}
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

	public function test_the_cache_probe_answers_true_once_an_earlier_call_planted_its_marker(): void {
		wp_cache_delete( 'cache_probe', 'wpsignal' );
		$this->assertFalse( Journeys::cache_persists(), 'the first call finds nothing and plants the marker' );
		$this->assertTrue( Journeys::cache_persists(), 'the next call finds it' );
	}

	public function test_the_marker_is_planted_ahead_at_activation_and_when_history_turns_on_and_the_staff_route_reads_it(): void {
		wp_cache_delete( 'cache_probe', 'wpsignal' );
		Journeys::plant_cache_probe();
		$this->assertTrue( Journeys::cache_persists(), 'what activation plants, the first look finds' );

		wp_cache_delete( 'cache_probe', 'wpsignal' );
		update_option( 'wpsignal_history_enabled', false );
		update_option( 'wpsignal_history_enabled', true );
		$this->assertTrue( Journeys::cache_persists(), 'History turning on plants it' );

		wp_cache_delete( 'cache_probe', 'wpsignal' );
		update_option( 'wpsignal_history_enabled', false );
		$this->assertFalse( Journeys::cache_persists(), 'turning it off plants nothing' );

		$this->as_admin();
		list( $status, $data ) = $this->rest( 'GET', 'cache' );
		$this->assertSame( array( 200, true ), array( $status, $data['persistent'] ), 'the route reads the marker the call before left' );
		wp_set_current_user( 0 );
		$this->assertSame( 401, $this->rest( 'GET', 'cache' )[0], 'staff only' );
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
		list( $status ) = $this->rest( 'POST', 'settings', array( 'journeys_retention_months' => 13 ) );
		$this->assertSame( 400, $status, 'the schema keeps the months between 1 and 12' );
		list( $status ) = $this->rest( 'POST', 'settings', array( 'journeys_retention_months' => 0 ) );
		$this->assertSame( 400, $status );
		list( $status, $data ) = $this->rest(
			'POST',
			'settings',
			array(
				'history_enabled'           => false,
				'journeys_retention_months' => 12,
			)
		);
		$this->assertSame( 200, $status );
		$this->assertFalse( $data['history_enabled'] );
		$this->assertSame( 12, $data['journeys_retention_months'] );
		list( , $data ) = $this->rest( 'GET', 'settings' );
		$this->assertFalse( $data['history_enabled'] );
		$this->assertSame( 12, $data['journeys_retention_months'] );
		update_option( 'wpsignal_journeys_retention_months', 36 );
		$this->assertSame( 12, WPS::instance()->config()->journeys_retention_months(), 'a saved value above the cap reads as the cap' );
		$this->assertArrayNotHasKey( 'firedUrl', WPS::rules()->config(), 'nothing listens and history is off' );
		update_option( 'wpsignal_history_enabled', true );
		$this->assertArrayHasKey( 'firedUrl', WPS::rules()->config(), 'history on: firings are stored' );
	}
}
