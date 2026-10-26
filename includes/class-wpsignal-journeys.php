<?php
/**
 * WPSignal\Journeys: the history of visitor journeys, kept on the site while History is on.
 *
 * - One row per journey in `{prefix}wpsignal_journeys`, written from the visit, leave and fired routes.
 * - A row holds the visitor id, the steps, an outcome (`open`, `left`, or one an extension ends it with),
 *   a value, an extension's `ref` (ShopSocket's cart id), the firings, and the user id of a logged-in visit.
 * - Extensions describe their outcomes and their ref, end journeys, credit firings and erase by ref
 *   through `WPS::journeys()`, and add to a report's record through `wpsignal_journey_record`.
 * - The feed behind the Moments tab's replay, the figures behind the Journeys tab, WordPress's privacy
 *   exporter and eraser, and a daily prune.
 *
 * @package WordSocket
 */

namespace WPSignal;

use WP_REST_Request;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, WordPress.DB.PreparedSQLPlaceholders -- The plugin's own table: its name from `table()`, fragments from prepare().

/**
 * The journeys table, its writes, and what reads it.
 *
 * @since 0.31.0
 */
class Journeys {

	/**
	 * The table's `dbDelta` version.
	 *
	 * @since 0.31.0
	 */
	const DB_VERSION = '2';

	/**
	 * The daily prune.
	 *
	 * @since 0.31.0
	 */
	const CRON_HOOK = 'wpsignal_prune_journeys';

	/**
	 * Firings a journey keeps, newest last.
	 *
	 * @since 0.31.0
	 */
	const MAX_FIRINGS = 50;

	/**
	 * Journey rows one visitor id may start in an hour.
	 *
	 * @since 0.31.0
	 */
	const NEW_PER_HOUR = 30;

	/**
	 * Rows one prune statement deletes before checking the clock, and the seconds a prune may run.
	 *
	 * @since 0.31.0
	 */
	const PRUNE_BATCH   = 1000;
	const PRUNE_SECONDS = 2;

	/**
	 * The feed's defaults and ceilings.
	 *
	 * @since 0.31.0
	 */
	const FEED_DAYS      = 28;
	const FEED_MAX_DAYS  = 90;
	const FEED_LIMIT     = 1000;
	const FEED_MAX_LIMIT = 1000;

	/**
	 * The visuals' window, the newest journeys they list, the longest a step counts for, and how long a
	 * computed answer is cached.
	 *
	 * @since 0.31.0
	 */
	const VISUALS_DAYS      = 28;
	const VISUALS_JOURNEYS  = 1000;
	const MAX_STEP_SECONDS  = DAY_IN_SECONDS;
	const CACHE_TTL         = 60;
	const VISUALS_TRANSIENT = 'wpsignal_journey_visuals';

	/**
	 * Seconds after a firing within which a credit still reaches it.
	 *
	 * @since 0.31.0
	 */
	const CREDIT_WINDOW = 7 * DAY_IN_SECONDS;

	/**
	 * What an outcome key, a ref and a colour look like.
	 *
	 * @since 0.31.0
	 */
	const OUTCOME_PATTERN = '/^[a-z][a-z_]{0,19}$/';
	const REF_PATTERN     = '/^[A-Za-z0-9_-]{1,32}$/';
	const COLOR_PATTERN   = '/^#[0-9a-f]{6}$/i';

	/**
	 * Configuration accessor.
	 *
	 * @var Config
	 */
	private $config;

	/**
	 * Registered outcomes: key => { label, color, series }.
	 *
	 * @var array<string, array{label: string, color: string, series: string}>
	 */
	private $outcomes = array();

	/**
	 * What an extension's ref is, when one said: { label, left_series }.
	 *
	 * @var array{label: string, left_series: string}|null
	 */
	private $ref = null;

	/**
	 * Constructor.
	 *
	 * @since 0.31.0
	 *
	 * @param Config $config Configuration accessor.
	 */
	public function __construct( Config $config ) {
		$this->config = $config;
	}

	/**
	 * Hook the table install, the report writes, the prune, and the privacy tools.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function init(): void {
		add_action( 'plugins_loaded', array( $this, 'install' ) );
		add_action( 'init', array( $this, 'register_defaults' ), 5 );
		add_action( 'init', array( $this, 'schedule' ) );
		add_action( 'wpsignal_visitor_visit', array( $this, 'on_report' ) );
		add_action( 'wpsignal_visitor_leave', array( $this, 'on_report' ) );
		add_action( self::CRON_HOOK, array( $this, 'prune' ) );
		add_filter( 'wp_privacy_personal_data_exporters', array( $this, 'register_exporter' ) );
		add_filter( 'wp_privacy_personal_data_erasers', array( $this, 'register_eraser' ) );
		add_action( 'admin_init', array( $this, 'privacy_policy' ) );
	}

	/**
	 * The table name.
	 *
	 * @since 0.31.0
	 *
	 * @return string
	 */
	public static function table(): string {
		global $wpdb;
		return $wpdb->prefix . 'wpsignal_journeys';
	}

	/**
	 * Whether journeys are being kept.
	 *
	 * @since 0.31.0
	 *
	 * @return bool
	 */
	public function enabled(): bool {
		return $this->config->history_enabled();
	}

	/**
	 * Create or update the table.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function install(): void {
		if ( $this->config->db_version() === self::DB_VERSION ) {
			return;
		}
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table   = self::table();
		$collate = $wpdb->get_charset_collate();
		dbDelta(
			"CREATE TABLE {$table} (
			journey_id char(36) NOT NULL,
			visitor char(36) NOT NULL,
			user_id bigint(20) unsigned NULL,
			ref varchar(32) NULL,
			journey text NULL,
			steps smallint unsigned NOT NULL DEFAULT 0,
			outcome varchar(20) NOT NULL DEFAULT 'open',
			value decimal(13,4) NULL,
			started_at datetime NOT NULL,
			last_seen datetime NOT NULL,
			ended_at datetime NULL,
			firings text NULL,
			PRIMARY KEY  (journey_id),
			KEY visitor_started (visitor, started_at),
			KEY user_id (user_id),
			KEY ref (ref),
			KEY started_at (started_at),
			KEY outcome (outcome)
		) {$collate};"
		);
		$this->config->save_db_version( self::DB_VERSION );
	}

	/**
	 * Schedule the daily prune once.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function schedule(): void {
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + DAY_IN_SECONDS, 'daily', self::CRON_HOOK );
		}
	}

	/**
	 * Drop the table and the schedule, for uninstall.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public static function uninstall(): void {
		global $wpdb;
		$wpdb->query( 'DROP TABLE IF EXISTS ' . self::table() );
		wp_clear_scheduled_hook( self::CRON_HOOK );
		delete_transient( self::VISUALS_TRANSIENT );
	}

	/**
	 * The outcomes every journey may end in, with translated labels.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function register_defaults(): void {
		$this->outcome(
			'open',
			array(
				'label' => __( 'Still open', 'wordsocket' ),
				'color' => '#a7aaad',
			)
		);
		$this->outcome(
			'left',
			array(
				'label' => __( 'Left', 'wordsocket' ),
				'color' => '#3c434a',
			)
		);
	}

	/**
	 * Describe an outcome a journey may end in: its label, its colour on the visuals, and the
	 * trend it draws as a series ("Orders a day"), if any.
	 *
	 * @since 0.31.0
	 *
	 * @param string $key  `[a-z_]`, up to 20 characters.
	 * @param array  $args `{ label, color?, series? }`.
	 * @return void
	 */
	public function outcome( string $key, array $args ): void {
		if ( 1 !== preg_match( self::OUTCOME_PATTERN, $key ) ) {
			return;
		}
		$color                  = (string) ( $args['color'] ?? '' );
		$this->outcomes[ $key ] = array(
			'label'  => (string) ( $args['label'] ?? $key ),
			'color'  => 1 === preg_match( self::COLOR_PATTERN, $color ) ? strtolower( $color ) : '#008300',
			'series' => (string) ( $args['series'] ?? '' ),
		);
	}

	/**
	 * Say what a journey's `ref` is (ShopSocket: a cart), and what the journeys left with one are
	 * called as a trend ("Carts left behind a day").
	 *
	 * @since 0.31.0
	 *
	 * @param array $args `{ label, left_series? }`.
	 * @return void
	 */
	public function ref( array $args ): void {
		$this->ref = array(
			'label'       => (string) ( $args['label'] ?? '' ),
			'left_series' => (string) ( $args['left_series'] ?? '' ),
		);
	}

	/**
	 * The registered outcomes, the built-in ones first.
	 *
	 * @since 0.31.0
	 *
	 * @return array<string, array{label: string, color: string, series: string}>
	 */
	public function outcomes(): array {
		return $this->outcomes;
	}

	/**
	 * Now, as SQL UTC.
	 *
	 * @since 0.31.0
	 *
	 * @return string
	 */
	private static function now(): string {
		return gmdate( 'Y-m-d H:i:s' );
	}

	/**
	 * A SQL datetime as RFC 3339 UTC.
	 *
	 * @since 0.31.0
	 *
	 * @param string $datetime SQL UTC.
	 * @return string
	 */
	private static function rfc3339( string $datetime ): string {
		return gmdate( 'c', (int) strtotime( $datetime . ' UTC' ) );
	}

	/**
	 * Whether a journey id may take a row: one on file always may, a new one only while the visitor
	 * id has started fewer than NEW_PER_HOUR (`wpsignal_journeys_per_hour`) in the last hour.
	 *
	 * @since 0.31.0
	 *
	 * @param string $visitor    The visitor id.
	 * @param string $journey_id The journey.
	 * @return bool
	 */
	private function may_start( string $visitor, string $journey_id ): bool {
		global $wpdb;
		if ( '' !== (string) $wpdb->get_var( $wpdb->prepare( 'SELECT journey_id FROM ' . self::table() . ' WHERE journey_id = %s', $journey_id ) ) ) {
			return true;
		}
		/**
		 * Filters how many journey rows a visitor id may start in an hour.
		 *
		 * @since 0.31.0
		 *
		 * @param int $limit Default `Journeys::NEW_PER_HOUR`, 30.
		 */
		$limit  = max( 1, (int) apply_filters( 'wpsignal_journeys_per_hour', self::NEW_PER_HOUR ) );
		$recent = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM ' . self::table() . ' WHERE visitor = %s AND started_at >= %s',
				$visitor,
				gmdate( 'Y-m-d H:i:s', time() - HOUR_IN_SECONDS )
			)
		);
		return $recent < $limit;
	}

	/**
	 * What the report's record carries beyond the journey: an extension's ref and value.
	 *
	 * @since 0.31.0
	 *
	 * @param array $report The report.
	 * @return array{ref: string, value: float|null}
	 */
	private function record_of( array $report ): array {
		/**
		 * Filters what a journey row keeps of a visit or leave report beyond the journey itself:
		 * `ref`, an extension's own id for what the visitor carries (ShopSocket's cart id, up to 32
		 * characters of `[A-Za-z0-9_-]`), and `value`, what it is worth.
		 *
		 * @since 0.31.0
		 *
		 * @param array{ref: string, value: float|null} $record Empty to begin with.
		 * @param array                                   $report The report, as `wpsignal_visitor_visit` hands it.
		 */
		$record = (array) apply_filters(
			'wpsignal_journey_record',
			array(
				'ref'   => '',
				'value' => null,
			),
			$report
		);
		$ref    = (string) ( $record['ref'] ?? '' );
		return array(
			'ref'   => 1 === preg_match( self::REF_PATTERN, $ref ) ? $ref : '',
			'value' => isset( $record['value'] ) && is_numeric( $record['value'] ) ? round( (float) $record['value'], 4 ) : null,
		);
	}

	/**
	 * Write a visit or leave report: the first report creates the row, a later one from the same
	 * visitor that is at least as far along updates it, and a visit that creates a row ends the
	 * visitor's other open journeys.
	 *
	 * @since 0.31.0
	 *
	 * @param array $report `{ visitor, journey_id, journey, steps, user_id, data, leaving }`.
	 * @return void
	 */
	public function on_report( array $report ): void {
		global $wpdb;
		if ( ! $this->enabled() ) {
			return;
		}
		$journey_id = (string) $report['journey_id'];
		$visitor    = (string) $report['visitor'];
		if ( '' === $journey_id || ! $this->may_start( $visitor, $journey_id ) ) {
			return;
		}
		$leaving = (bool) $report['leaving'];
		$record  = $this->record_of( $report );
		$now     = self::now();
		$owned   = 'visitor = VALUES(visitor)';
		$ahead   = $owned . ' AND VALUES(steps) >= steps';
		$final   = "outcome NOT IN ('open', 'left')";
		$wpdb->query(
			$wpdb->prepare(
				'INSERT INTO ' . self::table() . " (journey_id, visitor, user_id, ref, journey, steps, outcome, value, started_at, last_seen, ended_at)
				VALUES (%s, %s, IF(%d > 0, %d, NULL), NULLIF(%s, ''), %s, %d, %s, IF(%d = 1, %f, NULL), %s, %s, NULLIF(%s, ''))
				ON DUPLICATE KEY UPDATE
					user_id = IF(" . $owned . ' AND VALUES(user_id) IS NOT NULL, VALUES(user_id), user_id),
					ref = IF(' . $owned . ' AND VALUES(ref) IS NOT NULL, VALUES(ref), ref),
					value = IF(' . $owned . ' AND VALUES(value) IS NOT NULL, VALUES(value), value),
					last_seen = IF(' . $ahead . ', VALUES(last_seen), last_seen),
					journey = IF(' . $ahead . ', VALUES(journey), journey),
					outcome = IF(' . $final . ' OR NOT (' . $ahead . '), outcome, VALUES(outcome)),
					ended_at = IF(' . $final . ' OR NOT (' . $ahead . '), ended_at, VALUES(ended_at)),
					steps = IF(' . $owned . ', GREATEST(steps, VALUES(steps)), steps)',
				$journey_id,
				$visitor,
				(int) ( $report['user_id'] ?? 0 ),
				(int) ( $report['user_id'] ?? 0 ),
				$record['ref'],
				(string) $report['journey'],
				(int) $report['steps'],
				$leaving ? 'left' : 'open',
				null === $record['value'] ? 0 : 1,
				(float) $record['value'],
				$now,
				$now,
				$leaving ? $now : ''
			)
		);
		// An insert affects one row, an update two: only a journey's first report ends the others.
		if ( $leaving || 1 !== (int) $wpdb->rows_affected ) {
			return;
		}
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE ' . self::table() . " SET outcome = 'left', ended_at = last_seen WHERE visitor = %s AND journey_id <> %s AND outcome = 'open'",
				$visitor,
				$journey_id
			)
		);
	}

	/**
	 * Start a row with no steps yet, for a firing that arrives before any report has; the next
	 * report fills it in and keeps this start.
	 *
	 * @since 0.31.0
	 *
	 * @param string $visitor    The visitor id.
	 * @param string $journey_id The journey id.
	 * @param int    $user_id    The logged-in visitor, or 0.
	 * @return bool Whether the visitor's row exists afterwards.
	 */
	private function start( string $visitor, string $journey_id, int $user_id ): bool {
		global $wpdb;
		if ( '' === $journey_id || ! $this->may_start( $visitor, $journey_id ) ) {
			return false;
		}
		$now = self::now();
		$wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO ' . self::table() . " (journey_id, visitor, user_id, journey, steps, outcome, started_at, last_seen)
				VALUES (%s, %s, IF(%d > 0, %d, NULL), '', 0, 'open', %s, %s)",
				$journey_id,
				$visitor,
				$user_id,
				$user_id,
				$now,
				$now
			)
		);
		return '' !== (string) $wpdb->get_var( $wpdb->prepare( 'SELECT journey_id FROM ' . self::table() . ' WHERE journey_id = %s AND visitor = %s', $journey_id, $visitor ) );
	}

	/**
	 * Append a firing report to the visitor's journey, starting the row when none exists yet; the
	 * fired route calls this ahead of `wpsignal_rule_fired`.
	 *
	 * @since 0.31.0
	 *
	 * @param array $report `{ visitor, journey_id, rule_id, action, step, ms, kind, user_id, data }`.
	 * @return void
	 */
	public function on_fired( array $report ): void {
		global $wpdb;
		if ( ! $this->enabled() ) {
			return;
		}
		$journey_id = (string) $report['journey_id'];
		$visitor    = (string) $report['visitor'];
		$row        = $wpdb->get_row( $wpdb->prepare( 'SELECT firings FROM ' . self::table() . ' WHERE journey_id = %s AND visitor = %s', $journey_id, $visitor ), ARRAY_A );
		if ( ! is_array( $row ) ) {
			if ( ! $this->start( $visitor, $journey_id, (int) ( $report['user_id'] ?? 0 ) ) ) {
				return;
			}
			$row = array( 'firings' => null );
		}
		$firings   = json_decode( (string) ( $row['firings'] ?? '' ), true );
		$firings   = is_array( $firings ) ? $firings : array();
		$kind      = (string) ( $report['kind'] ?? 'fired' );
		$firings[] = array(
			'rule'   => (string) $report['rule_id'],
			'action' => (string) $report['action'],
			'step'   => max( 0, (int) $report['step'] ),
			'ms'     => max( 0, (int) ( $report['ms'] ?? 0 ) ),
			'kind'   => in_array( $kind, Rules::FIRING_KINDS, true ) ? $kind : 'fired',
			'at'     => self::now(),
		);
		$wpdb->update(
			self::table(),
			array( 'firings' => wp_json_encode( array_slice( $firings, -self::MAX_FIRINGS ) ) ),
			array(
				'journey_id' => $journey_id,
				'visitor'    => $visitor,
			),
			array( '%s' ),
			array( '%s', '%s' )
		);
	}

	/**
	 * End the open journeys carrying a ref with an outcome an extension registered (ShopSocket:
	 * `converted` with the order total when a cart becomes an order); a journey already left stays
	 * left.
	 *
	 * @since 0.31.0
	 *
	 * @param string     $ref     The ref.
	 * @param string     $outcome A registered outcome.
	 * @param float|null $value   What the journey came to, kept as it was when null.
	 * @return int Journeys ended.
	 */
	public function end_by_ref( string $ref, string $outcome, ?float $value = null ): int {
		global $wpdb;
		if ( ! $this->enabled() || '' === $ref || ! isset( $this->outcomes[ $outcome ] ) ) {
			return 0;
		}
		$now = self::now();
		return (int) $wpdb->query(
			$wpdb->prepare(
				'UPDATE ' . self::table() . " SET outcome = %s, value = IF(%d = 1, %f, value), ended_at = %s, last_seen = %s WHERE ref = %s AND outcome = 'open'",
				$outcome,
				null === $value ? 0 : 1,
				(float) $value,
				$now,
				$now,
				$ref
			)
		);
	}

	/**
	 * Stamp an order on every firing of the ref's journeys within the window, across journeys, so
	 * the Moments tab can say what a moment led to; a firing already credited keeps its order.
	 *
	 * @since 0.31.0
	 *
	 * @param string $ref    The ref.
	 * @param int    $order  The order the ref became.
	 * @param float  $value  The order's value.
	 * @param int    $window Seconds back from now a firing still counts; CREDIT_WINDOW by default.
	 * @return int Firings stamped.
	 */
	public function credit( string $ref, int $order, float $value, int $window = self::CREDIT_WINDOW ): int {
		global $wpdb;
		if ( ! $this->enabled() || '' === $ref || $order <= 0 ) {
			return 0;
		}
		$now     = self::now();
		$since   = gmdate( 'Y-m-d H:i:s', time() - max( 0, $window ) );
		$rows    = (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT journey_id, firings FROM ' . self::table() . ' WHERE ref = %s AND firings IS NOT NULL', $ref ),
			ARRAY_A
		);
		$stamped = 0;
		foreach ( $rows as $row ) {
			$firings = json_decode( (string) $row['firings'], true );
			if ( ! is_array( $firings ) ) {
				continue;
			}
			$changed = false;
			foreach ( $firings as &$firing ) {
				if ( ! is_array( $firing ) || isset( $firing['order'] ) || 'fired' !== (string) ( $firing['kind'] ?? 'fired' ) || (string) ( $firing['at'] ?? '' ) < $since ) {
					continue;
				}
				$firing['order']    = $order;
				$firing['order_at'] = $now;
				$firing['value']    = round( $value, 2 );
				$changed            = true;
				++$stamped;
			}
			unset( $firing );
			if ( $changed ) {
				$wpdb->update( self::table(), array( 'firings' => wp_json_encode( $firings ) ), array( 'journey_id' => $row['journey_id'] ), array( '%s' ), array( '%s' ) );
			}
		}
		return $stamped;
	}

	/**
	 * Delete the journeys carrying any of the refs, for an extension's eraser.
	 *
	 * @since 0.31.0
	 *
	 * @param string[] $refs The refs.
	 * @return int Rows removed.
	 */
	public function erase_refs( array $refs ): int {
		global $wpdb;
		$refs = array_values( array_filter( array_map( 'strval', $refs ), static fn( string $ref ): bool => 1 === preg_match( self::REF_PATTERN, $ref ) ) );
		if ( empty( $refs ) ) {
			return 0;
		}
		$holders = implode( ',', array_fill( 0, count( $refs ), '%s' ) );
		return (int) $wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::table() . " WHERE ref IN ({$holders})", ...$refs ) );
	}

	/**
	 * Delete the journeys stamped with a user.
	 *
	 * @since 0.31.0
	 *
	 * @param int $user_id The user.
	 * @return int Rows removed.
	 */
	public function erase_user( int $user_id ): int {
		global $wpdb;
		if ( $user_id <= 0 ) {
			return 0;
		}
		return (int) $wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::table() . ' WHERE user_id = %d', $user_id ) );
	}

	/**
	 * The journeys of the last `$days` days, newest first, as the Moments tab's replay reads them.
	 *
	 * @since 0.31.0
	 *
	 * @param int $days  How far back.
	 * @param int $limit At most.
	 * @return array<int, array<string, mixed>>
	 */
	public function feed( int $days, int $limit ): array {
		global $wpdb;
		if ( ! $this->enabled() ) {
			return array();
		}
		$since = gmdate( 'Y-m-d H:i:s', time() - min( self::FEED_MAX_DAYS, max( 1, $days ) ) * DAY_IN_SECONDS );
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT journey, started_at, outcome, value, ref, firings FROM ' . self::table() . ' WHERE started_at >= %s ORDER BY started_at DESC LIMIT %d',
				$since,
				min( self::FEED_MAX_LIMIT, max( 1, $limit ) )
			),
			ARRAY_A
		);
		return array_map(
			static function ( array $row ): array {
				$firings = json_decode( (string) ( $row['firings'] ?? '' ), true );
				$entry   = array(
					'journey'    => (string) $row['journey'],
					'started_at' => self::rfc3339( (string) $row['started_at'] ),
					'outcome'    => (string) $row['outcome'],
					'value'      => round( (float) ( $row['value'] ?? 0 ), 2 ),
					'has_ref'    => '' !== (string) ( $row['ref'] ?? '' ),
					'firings'    => is_array( $firings ) ? array_values( $firings ) : array(),
				);
				/**
				 * Filters the context a stored journey offers the replay, for the conditions an
				 * extension registered (ShopSocket: `cart`, from the row's ref and value).
				 *
				 * @since 0.31.0
				 *
				 * @param array $context Empty to begin with.
				 * @param array $row     The row: `journey`, `started_at`, `outcome`, `value`, `ref`, `firings`.
				 */
				$entry['context'] = (array) apply_filters( 'wpsignal_journey_context', array(), $row );
				return $entry;
			},
			$rows
		);
	}

	/**
	 * The currency the journeys' values are in, as an extension names it.
	 *
	 * @since 0.31.0
	 *
	 * @return string ISO 4217, or empty.
	 */
	public function currency(): string {
		/**
		 * Filters the currency journey values and credited orders are in (ShopSocket: the store's).
		 *
		 * @since 0.31.0
		 *
		 * @param string $currency ISO 4217 code, empty when none.
		 */
		return (string) apply_filters( 'wpsignal_journeys_currency', '' );
	}

	/**
	 * The Journeys tab's figures over the last VISUALS_DAYS days on the site's clock, null with
	 * History off; a computed answer is kept CACHE_TTL seconds.
	 *
	 * @since 0.31.0
	 *
	 * @return array<string, mixed>|null
	 */
	public function visuals(): ?array {
		if ( ! $this->enabled() ) {
			return null;
		}
		$cached = get_transient( self::VISUALS_TRANSIENT );
		if ( is_array( $cached ) ) {
			return $cached;
		}
		$tz    = wp_timezone();
		$start = ( new \DateTimeImmutable( 'now', $tz ) )->setTime( 0, 0 )->sub( new \DateInterval( 'P' . ( self::VISUALS_DAYS - 1 ) . 'D' ) );
		$since = $start->setTimezone( new \DateTimeZone( 'UTC' ) )->format( 'Y-m-d H:i:s' );
		$days  = array();
		for ( $i = 0; $i < self::VISUALS_DAYS; $i++ ) {
			$days[ $start->add( new \DateInterval( 'P' . $i . 'D' ) )->format( 'Y-m-d' ) ] = array(
				'visits'   => 0,
				'left_ref' => 0,
				'outcomes' => array(),
			);
		}
		$hours = array_fill(
			0,
			7,
			array_fill(
				0,
				24,
				array(
					'visits'   => 0,
					'minutes'  => 0,
					'outcomes' => array(),
				)
			)
		);
		$total = $this->bucket( $since, $tz, $days, $hours );
		$list  = $this->newest( $since, $tz, array_keys( $days ), $hours );
		foreach ( $hours as &$row ) {
			foreach ( $row as &$cell ) {
				$cell['minutes'] = (int) round( $cell['minutes'] );
			}
			unset( $cell );
		}
		unset( $row );
		$visuals = array(
			'since'      => self::rfc3339( $since ),
			'timezone'   => wp_timezone_string(),
			'week_start' => (int) get_option( 'start_of_week', 1 ),
			'days'       => array_map( static fn( string $date, array $counts ): array => array( 'date' => $date ) + $counts, array_keys( $days ), $days ),
			'hours'      => $hours,
			'journeys'   => $list,
			'total'      => $total,
			'outcomes'   => $this->outcomes(),
			'ref'        => $this->ref,
			'kinds'      => WPS::rules()->kinds(),
			'currency'   => $this->currency(),
		);
		set_transient( self::VISUALS_TRANSIENT, $visuals, self::CACHE_TTL );
		return $visuals;
	}

	/**
	 * Count the window's journeys into the days and the weekday-by-hour grid on the site's clock,
	 * by outcome.
	 *
	 * @since 0.31.0
	 *
	 * @param string        $since Window start, SQL UTC.
	 * @param \DateTimeZone $tz    The site's timezone.
	 * @param array         $days  Day buckets by local date, filled in place.
	 * @param array         $hours Weekday (0 Sunday) by hour cells, filled in place.
	 * @return int Journeys in the window.
	 */
	private function bucket( string $since, \DateTimeZone $tz, array &$days, array &$hours ): int {
		global $wpdb;
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT DATE_FORMAT(started_at, %s) AS h, outcome, COUNT(*) AS n, SUM(ref IS NOT NULL) AS r FROM ' . self::table() . ' WHERE started_at >= %s GROUP BY h, outcome',
				'%Y-%m-%d %H',
				$since
			),
			ARRAY_A
		);
		$total = 0;
		$utc   = new \DateTimeZone( 'UTC' );
		foreach ( $rows as $row ) {
			$local                        = ( new \DateTimeImmutable( $row['h'] . ':00:00', $utc ) )->setTimezone( $tz );
			$date                         = $local->format( 'Y-m-d' );
			$outcome                      = (string) $row['outcome'];
			$n                            = (int) $row['n'];
			$total                       += $n;
			$cell                         = &$hours[ (int) $local->format( 'w' ) ][ (int) $local->format( 'G' ) ];
			$cell['visits']              += $n;
			$cell['outcomes'][ $outcome ] = ( $cell['outcomes'][ $outcome ] ?? 0 ) + $n;
			unset( $cell );
			if ( isset( $days[ $date ] ) ) {
				$days[ $date ]['visits']              += $n;
				$days[ $date ]['outcomes'][ $outcome ] = ( $days[ $date ]['outcomes'][ $outcome ] ?? 0 ) + $n;
				if ( 'left' === $outcome ) {
					$days[ $date ]['left_ref'] += (int) $row['r'];
				}
			}
		}
		return $total;
	}

	/**
	 * The newest journeys of the window for the network, each placed on its local day and minute,
	 * pouring their time on the site into the grid's minutes.
	 *
	 * @since 0.31.0
	 *
	 * @param string        $since Window start, SQL UTC.
	 * @param \DateTimeZone $tz    The site's timezone.
	 * @param string[]      $dates The window's local dates, oldest first.
	 * @param array         $hours Weekday by hour cells, minutes added in place.
	 * @return array<int, array<string, mixed>>
	 */
	private function newest( string $since, \DateTimeZone $tz, array $dates, array &$hours ): array {
		global $wpdb;
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT journey, started_at, outcome, ref, value FROM ' . self::table() . ' WHERE started_at >= %s ORDER BY started_at DESC LIMIT %d',
				$since,
				self::VISUALS_JOURNEYS
			),
			ARRAY_A
		);
		$index = array_flip( $dates );
		$utc   = new \DateTimeZone( 'UTC' );
		$list  = array();
		foreach ( $rows as $row ) {
			$started = new \DateTimeImmutable( (string) $row['started_at'], $utc );
			$local   = $started->setTimezone( $tz );
			$list[]  = array(
				'journey'    => (string) $row['journey'],
				'started_at' => self::rfc3339( (string) $row['started_at'] ),
				'outcome'    => (string) $row['outcome'],
				'has_ref'    => '' !== (string) ( $row['ref'] ?? '' ),
				'value'      => round( (float) ( $row['value'] ?? 0 ), 2 ),
				'day'        => $index[ $local->format( 'Y-m-d' ) ] ?? -1,
				'minute'     => 60 * (int) $local->format( 'G' ) + (int) $local->format( 'i' ),
			);
			self::pour( (string) $row['journey'], $started->getTimestamp(), $tz, $hours );
		}
		return $list;
	}

	/**
	 * Add a journey's time on the site to the cells it fell in, each step counted for at most
	 * MAX_STEP_SECONDS; `away` steps advance the clock and add nothing.
	 *
	 * @since 0.31.0
	 *
	 * @param string        $journey The `kind:id:ms` steps.
	 * @param int           $start   When the journey started, Unix seconds.
	 * @param \DateTimeZone $tz      The site's timezone.
	 * @param array         $hours   Weekday by hour cells, minutes added in place.
	 * @return void
	 */
	private static function pour( string $journey, int $start, \DateTimeZone $tz, array &$hours ): void {
		if ( '' === $journey ) {
			return;
		}
		$t = (float) $start;
		foreach ( explode( '>', $journey ) as $step ) {
			list( $kind, , $ms ) = array_pad( explode( ':', $step ), 3, '0' );
			$left                = min( self::MAX_STEP_SECONDS, max( 0, (int) $ms ) / 1000 );
			if ( 'away' === $kind || '' === $kind ) {
				$t += $left;
				continue;
			}
			while ( $left > 0 ) {
				$at     = new \DateTimeImmutable( '@' . (int) floor( $t ) );
				$offset = $tz->getOffset( $at );
				$slice  = min( $left, 3600 - fmod( $t + $offset, 3600 ) );
				$local  = $at->setTimezone( $tz );
				$hours[ (int) $local->format( 'w' ) ][ (int) $local->format( 'G' ) ]['minutes'] += $slice / 60;
				$t    += $slice;
				$left -= $slice;
			}
		}
	}

	/**
	 * Delete journeys past the retention, in batches for at most PRUNE_SECONDS; every journey with
	 * History off.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function prune(): void {
		global $wpdb;
		$where = $this->enabled()
			? $wpdb->prepare( 'started_at < %s', gmdate( 'Y-m-d H:i:s', (int) strtotime( '-' . $this->config->journeys_retention_months() . ' months' ) ) )
			: '1 = 1';
		$began = microtime( true );
		do {
			$deleted = (int) $wpdb->query( 'DELETE FROM ' . self::table() . " WHERE {$where} LIMIT " . self::PRUNE_BATCH );
		} while ( $deleted >= self::PRUNE_BATCH && microtime( true ) - $began < self::PRUNE_SECONDS );
	}

	/**
	 * Add the journeys exporter to WordPress's privacy tools.
	 *
	 * @since 0.31.0
	 *
	 * @param array $exporters The exporters.
	 * @return array
	 */
	public function register_exporter( array $exporters ): array {
		$exporters['wpsignal_journeys'] = array(
			'exporter_friendly_name' => __( 'WordSocket journeys', 'wordsocket' ),
			'callback'               => array( $this, 'export' ),
		);
		return $exporters;
	}

	/**
	 * Add the journeys eraser to WordPress's privacy tools.
	 *
	 * @since 0.31.0
	 *
	 * @param array $erasers The erasers.
	 * @return array
	 */
	public function register_eraser( array $erasers ): array {
		$erasers['wpsignal_journeys'] = array(
			'eraser_friendly_name' => __( 'WordSocket journeys', 'wordsocket' ),
			'callback'             => array( $this, 'erase' ),
		);
		return $erasers;
	}

	/**
	 * The journeys stamped with the user behind an email, for the exporter.
	 *
	 * @since 0.31.0
	 *
	 * @param string $email The email.
	 * @return array{data: array, done: bool}
	 */
	public function export( string $email ): array {
		global $wpdb;
		$user = get_user_by( 'email', $email );
		$data = array();
		if ( $user ) {
			$rows = (array) $wpdb->get_results(
				$wpdb->prepare( 'SELECT journey_id, journey, outcome, value, started_at, ended_at FROM ' . self::table() . ' WHERE user_id = %d ORDER BY started_at', $user->ID ),
				ARRAY_A
			);
			foreach ( $rows as $row ) {
				$data[] = array(
					'group_id'    => 'wpsignal_journeys',
					'group_label' => __( 'WordSocket journeys', 'wordsocket' ),
					'item_id'     => 'wpsignal-journey-' . $row['journey_id'],
					'data'        => array(
						array(
							'name'  => __( 'Started', 'wordsocket' ),
							'value' => (string) $row['started_at'],
						),
						array(
							'name'  => __( 'Ended', 'wordsocket' ),
							'value' => (string) ( $row['ended_at'] ?? '' ),
						),
						array(
							'name'  => __( 'Outcome', 'wordsocket' ),
							'value' => (string) $row['outcome'],
						),
						array(
							'name'  => __( 'Value', 'wordsocket' ),
							'value' => (string) ( $row['value'] ?? '' ),
						),
						array(
							'name'  => __( 'Pages', 'wordsocket' ),
							'value' => (string) $row['journey'],
						),
					),
				);
			}
		}
		return array(
			'data' => $data,
			'done' => true,
		);
	}

	/**
	 * Delete the journeys stamped with the user behind an email, for the eraser.
	 *
	 * @since 0.31.0
	 *
	 * @param string $email The email.
	 * @return array{items_removed: int, items_retained: bool, messages: string[], done: bool}
	 */
	public function erase( string $email ): array {
		$user = get_user_by( 'email', $email );
		return array(
			'items_removed'  => $user ? $this->erase_user( $user->ID ) : 0,
			'items_retained' => false,
			'messages'       => array(),
			'done'           => true,
		);
	}

	/**
	 * What the privacy policy guide suggests saying about journeys.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function privacy_policy(): void {
		if ( ! function_exists( 'wp_add_privacy_policy_content' ) ) {
			return;
		}
		wp_add_privacy_policy_content(
			'WordSocket',
			wp_kses_post(
				'<p>' . __( 'With journey history on, WordSocket keeps the pages each visitor opened on this site and how long they stayed on each, as page ids and durations under a random browser id, for the number of months set in its settings. The record is linked to your account for the visits you were logged in. Nothing of this leaves the site, and the privacy tools here can export and erase it.', 'wordsocket' ) . '</p>'
			)
		);
	}

	/**
	 * Register `GET /wpsignal/v1/journeys` (the replay's feed) and `/journeys/visuals` (the Journeys tab).
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function register_routes(): void {
		$staff = static fn() => current_user_can( 'manage_options' );
		register_rest_route(
			'wpsignal/v1',
			'/journeys',
			array(
				'methods'             => 'GET',
				'args'                => array(
					'days'  => array(
						'type'    => 'integer',
						'default' => self::FEED_DAYS,
						'minimum' => 1,
						'maximum' => self::FEED_MAX_DAYS,
					),
					'limit' => array(
						'type'    => 'integer',
						'default' => self::FEED_LIMIT,
						'minimum' => 1,
						'maximum' => self::FEED_MAX_LIMIT,
					),
				),
				'callback'            => fn( WP_REST_Request $request ) => rest_ensure_response(
					array(
						'enabled'  => $this->enabled(),
						'currency' => $this->currency(),
						'journeys' => $this->feed( (int) $request->get_param( 'days' ), (int) $request->get_param( 'limit' ) ),
					)
				),
				'permission_callback' => $staff,
			)
		);
		register_rest_route(
			'wpsignal/v1',
			'/journeys/visuals',
			array(
				'methods'             => 'GET',
				'callback'            => fn() => rest_ensure_response( $this->visuals() ),
				'permission_callback' => $staff,
			)
		);
	}
}
