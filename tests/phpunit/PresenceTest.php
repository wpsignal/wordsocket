<?php
/**
 * Presence: the visit and leave routes behind `WPS.presence.track()`, the
 * reports they hand to the actions, and the page step filter.
 */

use WPSignal\Presence;
use WPSignal\WPS;

final class PresenceTest extends WordSocketTestCase {

	private const V = '0b2b6a4e-9f0a-4c7a-8f1c-1d2e3f4a5b6c';
	private const N = '7c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

	/** @var array<int, array> Reports the actions received during a test. */
	private array $visits = array();
	private array $leaves = array();

	/** @var callable */
	private $on_visit;
	/** @var callable */
	private $on_leave;

	protected function setUp(): void {
		parent::setUp();
		$this->visits   = array();
		$this->leaves   = array();
		$this->on_visit = function ( array $report ): void {
			$this->visits[] = $report;
		};
		$this->on_leave = function ( array $report ): void {
			$this->leaves[] = $report;
		};
		add_action( 'wpsignal_visitor_visit', $this->on_visit );
		add_action( 'wpsignal_visitor_leave', $this->on_leave );
	}

	protected function tearDown(): void {
		remove_action( 'wpsignal_visitor_visit', $this->on_visit );
		remove_action( 'wpsignal_visitor_leave', $this->on_leave );
		parent::tearDown();
	}

	public function test_a_visit_is_handed_to_the_visit_action_as_a_guest(): void {
		list( $status, $data ) = $this->rest(
			'POST',
			'visit',
			array(
				'v'       => strtoupper( self::V ),
				'n'       => self::N,
				'journey' => 'home:2:1200>post:1:300',
				'data'    => array( 'b' => 'cart-abc' ),
			)
		);
		$this->assertSame( 200, $status );
		$this->assertTrue( $data['ok'] );
		$this->assertCount( 1, $this->visits );
		$this->assertCount( 0, $this->leaves );
		$this->assertSame(
			array(
				'visitor'    => self::V,
				'journey_id' => self::N,
				'journey'    => 'home:2:1200>post:1:300',
				'steps'      => 2,
				'user_id'    => 0,
				'data'       => array( 'b' => 'cart-abc' ),
				'leaving'    => false,
			),
			$this->visits[0],
			'ids are lower-cased, steps counted, a guest is user 0'
		);
	}

	public function test_a_leave_is_handed_to_the_leave_action_as_the_logged_in_user(): void {
		$this->as_admin();
		list( $status ) = $this->rest(
			'POST',
			'leave',
			array(
				'v'       => self::V,
				'n'       => self::N,
				'journey' => 'home:2:1200>away:0:5000',
			)
		);
		$this->assertSame( 200, $status );
		$this->assertCount( 1, $this->leaves );
		$this->assertCount( 0, $this->visits );
		$this->assertSame( get_current_user_id(), $this->leaves[0]['user_id'] );
		$this->assertTrue( $this->leaves[0]['leaving'] );
		$this->assertSame( 2, $this->leaves[0]['steps'] );
		$this->assertSame( array(), $this->leaves[0]['data'], 'no data is an empty array, never null' );
	}

	public function test_an_empty_journey_is_a_visit_with_no_steps(): void {
		list( $status ) = $this->rest(
			'POST',
			'visit',
			array(
				'v' => self::V,
				'n' => self::N,
			)
		);
		$this->assertSame( 200, $status );
		$this->assertSame( 0, $this->visits[0]['steps'] );
		$this->assertSame( '', $this->visits[0]['journey'] );
	}

	public function test_bad_ids_and_bad_journeys_are_refused_before_any_action_runs(): void {
		$cases = array(
			'missing journey id' => array( 'v' => self::V ),
			'visitor not a uuid' => array(
				'v' => 'visitor-1',
				'n' => self::N,
			),
			'a url in a step'    => array(
				'v'       => self::V,
				'n'       => self::N,
				'journey' => 'post:/shop/:300',
			),
			'a word as an id'    => array(
				'v'       => self::V,
				'n'       => self::N,
				'journey' => 'post:hello:300',
			),
			'wrong separator'    => array(
				'v'       => self::V,
				'n'       => self::N,
				'journey' => 'home:1:1,post:2:2',
			),
			'too long'           => array(
				'v'       => self::V,
				'n'       => self::N,
				'journey' => implode( '>', array_fill( 0, 400, 'post:1234:99999' ) ),
			),
			'too many fields'    => array(
				'v'    => self::V,
				'n'    => self::N,
				'data' => array_fill_keys( range( 1, 21 ), 'x' ),
			),
		);
		foreach ( $cases as $label => $params ) {
			list( $status ) = $this->rest( 'POST', 'visit', $params );
			$this->assertSame( 400, $status, $label );
		}
		$this->assertCount( 0, $this->visits );
	}

	public function test_report_data_keeps_scalars_only_and_cuts_long_strings(): void {
		$clean = Presence::sanitize_data(
			array(
				'b'       => 'cart-abc',
				'Total'   => 12.5,
				'n'       => 3,
				'ok'      => true,
				'nested'  => array( 'a' => 1 ),
				'long'    => str_repeat( 'x', 500 ),
				'<script' => 'y',
			)
		);
		$this->assertSame( array( 'b', 'total', 'n', 'ok', 'long', 'script' ), array_keys( $clean ), 'keys are sanitized, nested values dropped' );
		$this->assertSame( 12.5, $clean['total'] );
		$this->assertTrue( $clean['ok'] );
		$this->assertSame( Presence::MAX_DATA_BYTES, strlen( $clean['long'] ) );
	}

	public function test_the_page_step_can_be_renamed_by_a_plugin(): void {
		$presence = WPS::instance()->presence();
		$rename   = static fn( array $step ): array => array(
			'kind' => 'Checkout Page',
			'id'   => '7',
		);
		add_filter( 'wpsignal_page_step', $rename );
		try {
			$step = $presence->page_step();
		} finally {
			remove_filter( 'wpsignal_page_step', $rename );
		}
		$this->assertSame(
			array(
				'kind' => 'checkoutpage',
				'id'   => 7,
			),
			$step,
			'the kind is a key, the id an integer'
		);

		$config = $presence->config();
		$this->assertSame( array( 'kind', 'id', 'visitUrl', 'leaveUrl', 'report' ), array_keys( $config ) );
		$this->assertFalse( $config['report'], 'history off: extensions decide who reports' );
		$this->assertStringEndsWith( '/wpsignal/v1/visit', $config['visitUrl'] );
		$this->assertStringEndsWith( '/wpsignal/v1/leave', $config['leaveUrl'] );
		$this->assertSame( 3, Presence::steps( 'a:1:1>b:2:2>away:0:3' ) );
	}

	public function test_a_post_type_archive_and_the_blog_index_are_their_own_kinds(): void {
		// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited -- the detector reads the main query, so the test drives it through the global.
		global $wp_query;
		$presence = WPS::instance()->presence();
		$original = $wp_query;
		$static   = static fn() => 'page';
		$of_flags = static function ( array $flags, ?object $queried = null, int $id = 0 ): WP_Query {
			$query = new WP_Query();
			foreach ( $flags as $flag ) {
				$query->$flag = true;
			}
			if ( $queried ) {
				$query->queried_object    = $queried;
				$query->queried_object_id = $id;
			}
			return $query;
		};
		add_filter( 'pre_option_show_on_front', $static );
		try {
			$wp_query = $of_flags( array( 'is_archive', 'is_post_type_archive' ), get_post_type_object( 'post' ) );
			$this->assertSame(
				array(
					'kind' => 'post_archive',
					'id'   => 0,
				),
				$presence->page_step(),
				'a post type archive is <type>_archive'
			);
			$wp_query = $of_flags( array( 'is_home' ), (object) array( 'ID' => 12 ), 12 );
			$this->assertSame(
				array(
					'kind' => 'post_archive',
					'id'   => 12,
				),
				$presence->page_step(),
				'the blog index is the posts archive, carrying its page id'
			);
			$wp_query = $of_flags( array( 'is_archive', 'is_date' ) );
			$this->assertSame(
				array(
					'kind' => 'archive',
					'id'   => 0,
				),
				$presence->page_step(),
				'a date archive stays the plain archive kind'
			);
		} finally {
			remove_filter( 'pre_option_show_on_front', $static );
			$wp_query = $original;
		}
		// phpcs:enable
	}

	public function test_a_plugin_answers_the_visit_through_the_response_filter_but_never_the_leave(): void {
		$seen   = array();
		$answer = static function ( array $fields, array $report ) use ( &$seen ): array {
			$seen[]         = $report['journey'];
			$fields['ok']   = false;
			$fields['shop'] = array( 'id' => 'cart-abc' );
			return $fields;
		};
		$body   = array(
			'v'       => self::V,
			'n'       => self::N,
			'journey' => 'home:2:1200',
		);
		add_filter( 'wpsignal_visitor_visit_response', $answer, 10, 2 );
		try {
			list( $status, $data ) = $this->rest( 'POST', 'visit', $body );
			$this->assertSame( 200, $status );
			$this->assertSame(
				array(
					'ok'   => true,
					'shop' => array( 'id' => 'cart-abc' ),
				),
				$data,
				'the plugin answers under its own key and cannot unset ok'
			);
			$this->assertSame( array( 'home:2:1200' ), $seen, 'the filter sees the report' );
			list( , $data ) = $this->rest( 'POST', 'leave', $body );
			$this->assertSame( array( 'ok' => true ), $data, 'a leave answers nothing extra' );
			$this->assertCount( 1, $seen, 'and never runs the filter' );
		} finally {
			remove_filter( 'wpsignal_visitor_visit_response', $answer, 10 );
		}
	}
}
