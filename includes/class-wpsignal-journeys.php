<?php
/**
 * WPSignal\Journeys: the history of visitor journeys, kept on the site while History is on.
 *
 * - One row per journey in `{prefix}wpsignal_journeys`, written from the visit, leave and fired routes.
 * - A row holds the visitor id, the steps, an outcome (`open`, `left`, or one an extension ends it with),
 *   a value, an extension's `ref` (ShopSocket's cart id), the firings, and the user id of a logged-in visit.
 * - Ids are stored as 16 bytes (`hex()`, `uuid()`), step kinds as codes (`pack_journey()`,
 *   `unpack_journeys()`, the `wpsignal_kind_codes` filter) and firings as tuples under one credited
 *   order (`pack_firings()`, `unpack_firings()`); every reader gets the named shapes back.
 * - Extensions describe their outcomes and their ref, end journeys, credit firings and erase by ref
 *   through `WPS::journeys()`, and add to a report's record through `wpsignal_journey_record`.
 * - The feed behind the Moments tab's replay, the figures behind the Journeys tab, WordPress's privacy
 *   exporter and eraser, and a daily prune.
 * - A purge for staff, every journey or those started between two days on the site's clock, through
 *   `DELETE /wpsignal/v1/journeys` and `wp wordsocket journeys purge`.
 *
 * @package WordSocket
 */

namespace WPSignal;

use WP_Error;
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
	const DB_VERSION = '4';

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
	 * A `YYYY-MM` month as the page route takes it.
	 *
	 * @since 0.31.0
	 */
	const MONTH_PATTERN = '/^\d{4}-(0[1-9]|1[0-2])\z/';

	/**
	 * A `YYYY-MM-DD` day as the purge takes it.
	 *
	 * @since 0.31.0
	 */
	const DATE_PATTERN = '/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\z/';

	/**
	 * Longest `data` an extension may put on a row, as JSON.
	 *
	 * @since 0.31.0
	 */
	const MAX_DATA_BYTES = 4000;

	/**
	 * The step kind codes WordSocket owns: one letter each, `p` for any post type and `t` for any
	 * taxonomy, a post type's archive `<type>_a`; extensions add theirs through `wpsignal_kind_codes`.
	 *
	 * @since 0.31.0
	 */
	const KIND_CODES     = array(
		'home'    => 'h',
		'away'    => 'w',
		'search'  => 's',
		'archive' => 'a',
		'other'   => 'o',
		'admin'   => 'ad',
	);
	const POST_CODE      = 'p';
	const TERM_CODE      = 't';
	const CODE_PATTERN   = '/^[a-z_]+\z/';
	const ARCHIVE_SUFFIX = '_archive';
	const ARCHIVE_CODE   = '_' . self::KIND_CODES['archive'];
	/**
	 * What a step reads as when its post or term is gone.
	 *
	 * @since 0.31.0
	 */
	const DELETED_KIND = 'deleted';

	/**
	 * A firing's kind as the tuple stores it.
	 *
	 * @since 0.31.0
	 */
	const FIRING_KIND_CODES = array(
		'fired'     => 0,
		'returned'  => 1,
		'dismissed' => 2,
		'clicked'   => 3,
	);

	/**
	 * The outcomes a journey can still move on from; every other outcome is final.
	 *
	 * @since 0.31.0
	 */
	const NOT_FINAL = array( 'open', 'left', 'incomplete' );

	/**
	 * How long an open journey may go unreported before the prune marks it incomplete, in seconds.
	 *
	 * @since 0.31.0
	 */
	const STALE_SECONDS = 3600;

	/**
	 * How far back the prune looks for open journeys to mark, in seconds (30 days).
	 *
	 * @since 0.31.0
	 */
	const STALE_SCAN_SECONDS = 2592000;

	/**
	 * The columns `query()` selects, the ids as hex.
	 *
	 * @since 0.31.0
	 */
	const QUERY_COLUMNS = 'HEX(journey_id) AS journey_id, HEX(visitor) AS visitor, user_id, ref, journey, steps, outcome, value, started_at, last_seen, firings, data';

	/**
	 * What `query()` reads by default and at most: the days back and the rows.
	 *
	 * @since 0.31.0
	 */
	const QUERY_DAYS      = 28;
	const QUERY_MAX_DAYS  = 365;
	const QUERY_MAX_LIMIT = 10000;

	/**
	 * The journeys download: the `admin-post.php` action, its nonce and the rows it holds at most.
	 *
	 * @since 0.31.0
	 */
	const DOWNLOAD_ACTION = 'wpsignal_journeys_download';
	const DOWNLOAD_LIMIT  = 10000;

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
		add_action( 'wpsignal_visitor_visit', array( $this, 'on_report' ), 5 );
		add_action( 'wpsignal_visitor_leave', array( $this, 'on_report' ), 5 );
		add_filter( 'wpsignal_visitor_visit_response', array( $this, 'answer_visit' ), 5, 2 );
		add_action( self::CRON_HOOK, array( $this, 'prune' ) );
		add_filter( 'wp_privacy_personal_data_exporters', array( $this, 'register_exporter' ) );
		add_filter( 'wp_privacy_personal_data_erasers', array( $this, 'register_eraser' ) );
		add_action( 'admin_init', array( $this, 'privacy_policy' ) );
		add_action( 'admin_post_' . self::DOWNLOAD_ACTION, array( $this, 'handle_download' ) );
	}

	/**
	 * The `WHERE` a query's arguments describe: `days` back (QUERY_DAYS, up to QUERY_MAX_DAYS), `user`,
	 * `visitor` (a UUID), `ref`, `outcome`, `rule` (a firing of that moment), `fired` (any firing), and
	 * `exclude_visitor_prefix` (the leading hex digits of a UUID: rows whose visitor id starts with them are left out).
	 *
	 * @since 0.31.0
	 *
	 * @param array $args The arguments.
	 * @return string|WP_Error The clause, or `wpsignal_invalid_query` naming the argument.
	 */
	public static function query_where( array $args ) {
		global $wpdb;
		$days = (int) ( $args['days'] ?? self::QUERY_DAYS );
		if ( $days < 1 || $days > self::QUERY_MAX_DAYS ) {
			return new WP_Error( 'wpsignal_invalid_query', sprintf( 'days must be between 1 and %d.', self::QUERY_MAX_DAYS ), array( 'status' => 400 ) );
		}
		$where = array( $wpdb->prepare( 'started_at >= %s', gmdate( 'Y-m-d H:i:s', time() - $days * DAY_IN_SECONDS ) ) );
		if ( isset( $args['user'] ) && '' !== $args['user'] ) {
			$where[] = $wpdb->prepare( 'user_id = %d', (int) $args['user'] );
		}
		if ( isset( $args['visitor'] ) && '' !== $args['visitor'] ) {
			$hex = self::hex( (string) $args['visitor'] );
			if ( '' === $hex ) {
				return new WP_Error( 'wpsignal_invalid_query', 'visitor must be a UUID.', array( 'status' => 400 ) );
			}
			$where[] = $wpdb->prepare( 'visitor = UNHEX(%s)', $hex );
		}
		foreach ( array( 'ref', 'outcome' ) as $column ) {
			if ( isset( $args[ $column ] ) && '' !== $args[ $column ] ) {
				$where[] = $wpdb->prepare( "{$column} = %s", (string) $args[ $column ] );
			}
		}
		// A firing tuple opens with its rule: `["<id>",`.
		if ( isset( $args['rule'] ) && '' !== $args['rule'] ) {
			$where[] = $wpdb->prepare( 'firings LIKE %s', '%' . $wpdb->esc_like( '["' . (string) $args['rule'] . '",' ) . '%' );
		} elseif ( ! empty( $args['fired'] ) ) {
			$where[] = $wpdb->prepare( 'firings LIKE %s', '%' . $wpdb->esc_like( '"f":[[' ) . '%' );
		}
		if ( isset( $args['exclude_visitor_prefix'] ) && '' !== $args['exclude_visitor_prefix'] ) {
			$prefix = strtoupper( str_replace( '-', '', (string) $args['exclude_visitor_prefix'] ) );
			if ( 1 !== preg_match( '/^[0-9A-F]{1,32}\z/', $prefix ) ) {
				return new WP_Error( 'wpsignal_invalid_query', 'exclude_visitor_prefix must be the start of a UUID.', array( 'status' => 400 ) );
			}
			$where[] = $wpdb->prepare( 'HEX(visitor) NOT LIKE %s', $wpdb->esc_like( $prefix ) . '%' );
		}
		return implode( ' AND ', $where );
	}

	/**
	 * How many stored journeys the arguments of `query_where()` match.
	 *
	 * @since 0.31.0
	 *
	 * @param array $args The arguments.
	 * @return int|WP_Error
	 */
	public static function query_count( array $args ) {
		global $wpdb;
		$where = self::query_where( $args );
		if ( is_wp_error( $where ) ) {
			return $where;
		}
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- Table name from table(); the clause is prepared by query_where().
		return (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::table() . ' WHERE ' . $where );
	}

	/**
	 * Stored journeys as rows, newest first, as the table holds them: the arguments of `query_where()` plus `limit`
	 * (QUERY_MAX_LIMIT at most), selected with QUERY_COLUMNS, so ids are hex, the journey is in kind codes and the
	 * firings and data are their stored JSON.
	 *
	 * @since 0.31.0
	 *
	 * @param array $args The arguments.
	 * @return array<int, array<string, mixed>>|WP_Error
	 */
	public static function query_rows( array $args ) {
		global $wpdb;
		$where = self::query_where( $args );
		if ( is_wp_error( $where ) ) {
			return $where;
		}
		$limit = (int) ( $args['limit'] ?? self::QUERY_MAX_LIMIT );
		if ( $limit < 1 || $limit > self::QUERY_MAX_LIMIT ) {
			return new WP_Error( 'wpsignal_invalid_query', sprintf( 'limit must be between 1 and %d.', self::QUERY_MAX_LIMIT ), array( 'status' => 400 ) );
		}
		return array_values(
			(array) $wpdb->get_results(
				// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- Table name from table(); the clause is prepared by query_where().
				$wpdb->prepare( 'SELECT ' . self::QUERY_COLUMNS . ' FROM ' . self::table() . ' WHERE ' . $where . ' ORDER BY started_at DESC LIMIT %d', $limit ),
				ARRAY_A
			)
		);
	}

	/**
	 * Stored journeys as records, newest first: the rows of `query_rows()` through `record()`. What the CLI lists, the download holds and the `wordsocket/list-journeys` ability answers.
	 *
	 * @since 0.31.0
	 *
	 * @param array $args The arguments.
	 * @return array<int, array<string, mixed>>|WP_Error
	 */
	public static function query( array $args ) {
		$rows = self::query_rows( $args );
		if ( is_wp_error( $rows ) ) {
			return $rows;
		}
		$journeys = self::unpack_journeys( array_column( $rows, 'journey' ) );
		foreach ( $rows as $i => $row ) {
			$rows[ $i ] = self::record( $row, $journeys[ $i ] );
		}
		return array_values( $rows );
	}

	/**
	 * A row selected with QUERY_COLUMNS as a record: ids as UUIDs, times as RFC 3339, the journey in kind
	 * names with `path` its kinds alone, the firings named and the data decoded.
	 *
	 * @since 0.31.0
	 *
	 * @param array  $row     The row.
	 * @param string $journey The journey in kind names.
	 * @return array<string, mixed>
	 */
	public static function record( array $row, string $journey ): array {
		$data  = json_decode( (string) ( $row['data'] ?? '' ), true );
		$kinds = array_map( static fn( string $step ): string => explode( ':', $step )[0], array_filter( explode( '>', $journey ) ) );
		return array(
			'journey_id' => self::uuid( (string) $row['journey_id'] ),
			'visitor'    => self::uuid( (string) $row['visitor'] ),
			'user_id'    => (int) ( $row['user_id'] ?? 0 ),
			'ref'        => (string) ( $row['ref'] ?? '' ),
			'outcome'    => (string) $row['outcome'],
			'value'      => null === $row['value'] ? null : (float) $row['value'],
			'started_at' => self::rfc3339( (string) $row['started_at'] ),
			'last_seen'  => self::rfc3339( (string) $row['last_seen'] ),
			'steps'      => (int) $row['steps'],
			'path'       => implode( ' > ', $kinds ),
			'journey'    => $journey,
			'firings'    => self::unpack_firings( $row['firings'] ?? null ),
			'data'       => is_array( $data ) ? $data : null,
		);
	}

	/**
	 * What each record field means, for a file read without the docs.
	 *
	 * @since 0.31.0
	 *
	 * @return array<string, string>
	 */
	public static function legend(): array {
		return array(
			'journey_id' => 'One visit by one browser.',
			'visitor'    => 'The browser; its visits share this id.',
			'user_id'    => 'The WordPress user when logged in, 0 for a guest.',
			'ref'        => 'What the visitor carried, as an extension names it (ShopSocket: the cart id); empty when nothing.',
			'outcome'    => 'open (still going), left, incomplete (never heard ending), or an outcome an extension ends journeys with (ShopSocket: converted).',
			'value'      => 'The value an extension put on the journey, in `currency` (ShopSocket: the cart or order total).',
			'started_at' => 'When the visit began, UTC.',
			'last_seen'  => 'The last report, UTC; when the visit ended for a final outcome.',
			'steps'      => 'How many pages, with the hidden-tab spells (away) counted.',
			'path'       => 'The page kinds in order.',
			'journey'    => 'The steps in order as kind:id:seconds, joined by >; away:0:seconds is the tab hidden; ids are posts or terms.',
			'firings'    => 'The moments that fired on this visit: rule, action, step index, seconds into the step, kind (fired, returned, dismissed, clicked), at (UTC), and the order credited with its time and value.',
			'data'       => 'What the extension stored about the visit (ShopSocket: c the currency, i the cart items as product id to quantity, o the order id).',
		);
	}

	/**
	 * The journeys of the last `days` as a file, `csv` or `json`, newest first, DOWNLOAD_LIMIT rows at most:
	 * `{ filename, type, body }`.
	 *
	 * @since 0.31.0
	 *
	 * @param string $format `csv` or `json`.
	 * @param array  $args   The arguments of `query()`.
	 * @return array{filename: string, type: string, body: string}|WP_Error
	 */
	public function download( string $format, array $args = array() ) {
		if ( ! in_array( $format, array( 'csv', 'json' ), true ) ) {
			return new WP_Error( 'wpsignal_invalid_query', 'format must be csv or json.', array( 'status' => 400 ) );
		}
		$args['limit'] = min( self::DOWNLOAD_LIMIT, (int) ( $args['limit'] ?? self::DOWNLOAD_LIMIT ) );
		$records       = self::query( $args );
		if ( is_wp_error( $records ) ) {
			return $records;
		}
		$name = sanitize_file_name( 'journeys-' . wp_parse_url( home_url(), PHP_URL_HOST ) . '-' . gmdate( 'Y-m-d' ) . '.' . $format );
		if ( 'json' === $format ) {
			$body = (string) wp_json_encode(
				array(
					'site'        => home_url(),
					'exported_at' => gmdate( DATE_RFC3339 ),
					'days'        => (int) ( $args['days'] ?? self::QUERY_DAYS ),
					'count'       => count( $records ),
					'currency'    => $this->currency(),
					'legend'      => self::legend(),
					'journeys'    => $records,
				),
				JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
			);
			return array(
				'filename' => $name,
				'type'     => 'application/json',
				'body'     => $body,
			);
		}
		$out = fopen( 'php://temp', 'r+' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen -- An in-memory stream for fputcsv().
		fputcsv( $out, array_keys( self::legend() ), ',', '"', '' );
		foreach ( $records as $record ) {
			$record['firings'] = (string) wp_json_encode( $record['firings'] );
			$record['data']    = null === $record['data'] ? '' : (string) wp_json_encode( $record['data'] );
			$record['value']   = null === $record['value'] ? '' : $record['value'];
			fputcsv( $out, array_values( $record ), ',', '"', '' );
		}
		rewind( $out );
		$body = (string) stream_get_contents( $out );
		fclose( $out ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- The in-memory stream above.
		return array(
			'filename' => $name,
			'type'     => 'text/csv',
			'body'     => $body,
		);
	}

	/**
	 * The download's URL, nonced for the current user; the browser adds `format` and `days`.
	 *
	 * @since 0.31.0
	 *
	 * @return string
	 */
	public static function download_url(): string {
		return add_query_arg(
			array(
				'action'   => self::DOWNLOAD_ACTION,
				'_wpnonce' => wp_create_nonce( self::DOWNLOAD_ACTION ),
			),
			admin_url( 'admin-post.php' )
		);
	}

	/**
	 * `admin-post.php?action=wpsignal_journeys_download&format=csv|json&days=N`: the download, for `manage_options`.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function handle_download(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to download journeys.', 'wordsocket' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::DOWNLOAD_ACTION );
		$format = sanitize_key( (string) wp_unslash( $_GET['format'] ?? 'csv' ) );
		$days   = absint( wp_unslash( $_GET['days'] ?? self::QUERY_DAYS ) );
		$file   = $this->download( $format, array( 'days' => $days ) );
		if ( is_wp_error( $file ) ) {
			wp_die( esc_html( $file->get_error_message() ), '', array( 'response' => 400 ) );
		}
		nocache_headers();
		header( 'Content-Type: ' . $file['type'] . '; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="' . $file['filename'] . '"' );
		header( 'Content-Length: ' . strlen( $file['body'] ) );
		echo $file['body']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- A file the browser saves, not markup.
		exit;
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
		if ( '' !== $this->config->db_version() ) {
			$wpdb->query( "DROP TABLE IF EXISTS {$table}" );
		}
		dbDelta(
			"CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			journey_id binary(16) NOT NULL,
			visitor binary(16) NOT NULL,
			user_id bigint(20) unsigned NULL,
			ref varchar(32) NULL,
			journey text NULL,
			steps smallint unsigned NOT NULL DEFAULT 0,
			outcome varchar(20) NOT NULL DEFAULT 'open',
			value decimal(13,4) NULL,
			started_at datetime NOT NULL,
			last_seen datetime NOT NULL,
			firings text NULL,
			data text NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY journey_id (journey_id),
			KEY visitor_started (visitor, started_at),
			KEY user_id (user_id),
			KEY ref (ref),
			KEY started_at (started_at)
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
		$this->outcome(
			'incomplete',
			array(
				'label' => __( 'Incomplete', 'wordsocket' ),
				'color' => '#787c82',
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
	 * Now, or `$ago` seconds before it, as SQL UTC.
	 *
	 * @since 0.31.0
	 *
	 * @param int $ago Seconds before now.
	 * @return string
	 */
	private static function now( int $ago = 0 ): string {
		return gmdate( 'Y-m-d H:i:s', time() - $ago );
	}

	/**
	 * How long a journey ran, in seconds: its steps' times added up, each counted for a day at most.
	 *
	 * @since 0.31.0
	 *
	 * @param string $journey The `kind:id:s` steps joined by `>`.
	 * @return int
	 */
	public static function duration( string $journey ): int {
		$seconds = 0;
		foreach ( array_filter( explode( '>', $journey ) ) as $step ) {
			$parts    = explode( ':', $step );
			$seconds += min( self::MAX_STEP_SECONDS, max( 0, (int) ( $parts[2] ?? 0 ) ) );
		}
		return $seconds;
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
	 * A UUID as the 32 hex digits `UNHEX()` stores in a `binary(16)` column, or '' when it is not one.
	 *
	 * @since 0.31.0
	 *
	 * @param string $uuid The id as the browser sends it.
	 * @return string
	 */
	public static function hex( string $uuid ): string {
		$hex = strtolower( str_replace( '-', '', $uuid ) );
		return 1 === preg_match( '/^[0-9a-f]{32}\z/', $hex ) ? $hex : '';
	}

	/**
	 * A column's `HEX()` back as the UUID string, or '' when it is not 32 hex digits.
	 *
	 * @since 0.31.0
	 *
	 * @param string $hex `HEX(journey_id)` or `HEX(visitor)`.
	 * @return string
	 */
	public static function uuid( string $hex ): string {
		$hex = strtolower( $hex );
		if ( 1 !== preg_match( '/^[0-9a-f]{32}\z/', $hex ) ) {
			return '';
		}
		return sprintf( '%s-%s-%s-%s-%s', substr( $hex, 0, 8 ), substr( $hex, 8, 4 ), substr( $hex, 12, 4 ), substr( $hex, 16, 4 ), substr( $hex, 20 ) );
	}

	/**
	 * The step kind a taxonomy's term archives are recorded under: the taxonomy's name, `tag` for
	 * `post_tag`, and whatever `wpsignal_taxonomy_kind` renames (ShopSocket: `product_cat` as `category`).
	 *
	 * @since 0.31.0
	 *
	 * @param string $taxonomy The taxonomy.
	 * @return string
	 */
	public static function taxonomy_kind( string $taxonomy ): string {
		$kind = 'post_tag' === $taxonomy ? 'tag' : $taxonomy;
		/**
		 * Filters the step kind a taxonomy's term archives are recorded under.
		 *
		 * @since 0.31.0
		 *
		 * @param string $kind     The kind, the taxonomy's name by default (`tag` for `post_tag`).
		 * @param string $taxonomy The taxonomy.
		 */
		$kind = sanitize_key( (string) apply_filters( 'wpsignal_taxonomy_kind', $kind, $taxonomy ) );
		return '' === $kind ? $taxonomy : $kind;
	}

	/**
	 * The memoised codes by kind, read once per request.
	 *
	 * @var array<string, string>|null
	 */
	private static ?array $kind_codes = null;

	/**
	 * Forget the memoised codes, so the next pack or unpack reads the filter again.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public static function reset_kind_codes(): void {
		self::$kind_codes = null;
	}

	/**
	 * The codes by kind: WordSocket's, then the extensions' through `wpsignal_kind_codes`. A code of
	 * one letter outside WordSocket's, a malformed one, or one claimed twice is dropped, so the kind
	 * is stored by its full name.
	 *
	 * @since 0.31.0
	 *
	 * @return array<string, string>
	 */
	private static function kind_codes(): array {
		if ( null !== self::$kind_codes ) {
			return self::$kind_codes;
		}
		/**
		 * Filters the codes step kinds are stored under, `{ kind: code }`, codes of two or more
		 * letters (ShopSocket: `shop` as `sh`, `cart` as `ct`, `checkout` as `ck`, `thanks` as `ty`).
		 *
		 * @since 0.31.0
		 *
		 * @param array<string, string> $codes Empty to begin with; WordSocket's own are fixed.
		 */
		$added = (array) apply_filters( 'wpsignal_kind_codes', array() );
		$codes = self::KIND_CODES;
		$taken = array();
		$dupes = array();
		foreach ( $added as $kind => $code ) {
			$kind = sanitize_key( (string) $kind );
			$code = (string) $code;
			// WordSocket's kinds and codes are fixed; an extension's code is two or more letters.
			if ( '' === $kind || isset( $codes[ $kind ] ) || in_array( $code, $codes, true ) || strlen( $code ) < 2 || 1 !== preg_match( self::CODE_PATTERN, $code ) ) {
				continue;
			}
			if ( isset( $taken[ $code ] ) ) {
				$dupes[ $code ] = true;
				continue;
			}
			$codes[ $kind ] = $code;
			$taken[ $code ] = $kind;
		}
		foreach ( $dupes as $code => $unused ) {
			unset( $codes[ $taken[ $code ] ] );
		}
		self::$kind_codes = $codes;
		return $codes;
	}

	/**
	 * The kinds that are taxonomy archives right now, as `taxonomy_kind()` names them.
	 *
	 * @since 0.31.0
	 *
	 * @return array<string, true>
	 */
	private static function taxonomy_kinds(): array {
		static $kinds = null;
		if ( null === $kinds ) {
			$kinds = array();
			foreach ( get_taxonomies() as $taxonomy ) {
				$kinds[ (string) $taxonomy ]                        = true;
				$kinds[ self::taxonomy_kind( (string) $taxonomy ) ] = true;
			}
		}
		return $kinds;
	}

	/**
	 * A journey in kind names as the row stores it: each kind its code, a post type `p`, a taxonomy
	 * `t`, an archive `<type>_a`, anything else by its name.
	 *
	 * @since 0.31.0
	 *
	 * @param string $journey `kind:id:s` steps joined by `>`.
	 * @return string
	 */
	public static function pack_journey( string $journey ): string {
		if ( '' === $journey ) {
			return '';
		}
		$out = array();
		foreach ( explode( '>', $journey ) as $step ) {
			$parts = explode( ':', $step, 2 );
			$kind  = self::pack_kind( $parts[0] );
			$out[] = isset( $parts[1] ) ? $kind . ':' . $parts[1] : $kind;
		}
		return implode( '>', $out );
	}

	/**
	 * A step kind as the row stores it: its code, `p` for a post type, `t` for a taxonomy,
	 * `<type>_a` for an archive, the name itself for anything else.
	 *
	 * @since 0.31.0
	 *
	 * @param string $kind The kind.
	 * @return string
	 */
	public static function pack_kind( string $kind ): string {
		$codes = self::kind_codes();
		if ( isset( $codes[ $kind ] ) ) {
			return $codes[ $kind ];
		}
		if ( str_ends_with( $kind, self::ARCHIVE_SUFFIX ) ) {
			return substr( $kind, 0, -strlen( self::ARCHIVE_SUFFIX ) ) . self::ARCHIVE_CODE;
		}
		if ( post_type_exists( $kind ) ) {
			return self::POST_CODE;
		}
		if ( isset( self::taxonomy_kinds()[ $kind ] ) ) {
			return self::TERM_CODE;
		}
		return $kind;
	}

	/**
	 * A `WHERE` fragment matching journeys with a step of the kind, for a reader's own SQL.
	 *
	 * @since 0.31.0
	 *
	 * @param string $kind   The kind, in its name.
	 * @param string $column The journey column, `journey` by default.
	 * @return string
	 */
	public static function step_where( string $kind, string $column = 'journey' ): string {
		global $wpdb;
		$code = $wpdb->esc_like( self::pack_kind( $kind ) . ':' );
		return $wpdb->prepare( "({$column} LIKE %s OR {$column} LIKE %s)", $code . '%', '%>' . $code . '%' );
	}

	/**
	 * A `WHERE` fragment matching rows an order was credited to.
	 *
	 * @since 0.31.0
	 *
	 * @return string
	 */
	public static function credited_where(): string {
		global $wpdb;
		return $wpdb->prepare( 'firings LIKE %s', '%' . $wpdb->esc_like( '"o":{' ) . '%' );
	}

	/**
	 * Stored journeys back to kind names, the post types and taxonomies of `p` and `t` steps read
	 * from the tables in one query each (a type no longer registered still reads; a row that is gone
	 * reads as `deleted`), an unknown code as itself.
	 *
	 * @since 0.31.0
	 *
	 * @param string[] $stored Journeys as the rows hold them.
	 * @return string[] In the same order.
	 */
	public static function unpack_journeys( array $stored ): array {
		global $wpdb;
		$posts = array();
		$terms = array();
		foreach ( $stored as $journey ) {
			if ( '' === (string) $journey ) {
				continue;
			}
			foreach ( explode( '>', (string) $journey ) as $step ) {
				$parts = explode( ':', $step );
				$id    = (int) ( $parts[1] ?? 0 );
				if ( self::POST_CODE === $parts[0] && $id > 0 ) {
					$posts[ $id ] = true;
				} elseif ( self::TERM_CODE === $parts[0] && $id > 0 ) {
					$terms[ $id ] = true;
				}
			}
		}
		$types = array();
		if ( $posts ) {
			$in = implode( ',', array_map( 'intval', array_keys( $posts ) ) );
			foreach ( (array) $wpdb->get_results( "SELECT ID, post_type FROM {$wpdb->posts} WHERE ID IN ({$in})", ARRAY_A ) as $row ) {
				$types[ (int) $row['ID'] ] = sanitize_key( (string) $row['post_type'] );
			}
		}
		$taxes = array();
		if ( $terms ) {
			$in = implode( ',', array_map( 'intval', array_keys( $terms ) ) );
			// A pre-4.2 shared term has a row per taxonomy: the first wins.
			foreach ( (array) $wpdb->get_results( "SELECT term_id, taxonomy FROM {$wpdb->term_taxonomy} WHERE term_id IN ({$in}) ORDER BY term_taxonomy_id", ARRAY_A ) as $row ) {
				$taxes[ (int) $row['term_id'] ] = $taxes[ (int) $row['term_id'] ] ?? self::taxonomy_kind( (string) $row['taxonomy'] );
			}
		}
		$names = array_flip( self::kind_codes() );
		$out   = array();
		foreach ( $stored as $journey ) {
			$journey = (string) $journey;
			if ( '' === $journey ) {
				$out[] = '';
				continue;
			}
			$steps = array();
			foreach ( explode( '>', $journey ) as $step ) {
				$parts = explode( ':', $step, 2 );
				$code  = $parts[0];
				$rest  = $parts[1] ?? '';
				$id    = (int) explode( ':', $rest )[0];
				if ( self::POST_CODE === $code ) {
					$kind = $types[ $id ] ?? self::DELETED_KIND;
				} elseif ( self::TERM_CODE === $code ) {
					$kind = $taxes[ $id ] ?? self::DELETED_KIND;
				} elseif ( isset( $names[ $code ] ) ) {
					$kind = $names[ $code ];
				} elseif ( str_ends_with( $code, self::ARCHIVE_CODE ) ) {
					$kind = substr( $code, 0, -strlen( self::ARCHIVE_CODE ) ) . self::ARCHIVE_SUFFIX;
				} else {
					$kind = $code;
				}
				$steps[] = '' === $rest ? $kind : $kind . ':' . $rest;
			}
			$out[] = implode( '>', $steps );
		}
		return $out;
	}

	/**
	 * One stored journey back to kind names.
	 *
	 * @since 0.31.0
	 *
	 * @param string $stored The journey as the row holds it.
	 * @return string
	 */
	public static function unpack_journey( string $stored ): string {
		return self::unpack_journeys( array( $stored ) )[0];
	}

	/**
	 * Firings in the named shape as the row stores them: `{ "o": { id, at, v }, "f": [[ rule, action,
	 * step, s, kind, at ], ... ] }`, the order credited to the row once, each firing a tuple with its
	 * kind as a number and its time in Unix seconds.
	 *
	 * @since 0.31.0
	 *
	 * @param array $firings Named firings, `{ rule, action, step, s, kind, at, order?, order_at?, value? }` each.
	 * @return string JSON, '' for none.
	 */
	public static function pack_firings( array $firings ): string {
		$stored = array( 'f' => array() );
		foreach ( $firings as $firing ) {
			if ( ! is_array( $firing ) ) {
				continue;
			}
			$kind          = (string) ( $firing['kind'] ?? 'fired' );
			$stored['f'][] = array(
				(string) ( $firing['rule'] ?? '' ),
				(string) ( $firing['action'] ?? '' ),
				max( 0, (int) ( $firing['step'] ?? 0 ) ),
				max( 0, (int) ( $firing['s'] ?? 0 ) ),
				self::FIRING_KIND_CODES[ $kind ] ?? 0,
				self::unix( (string) ( $firing['at'] ?? '' ) ),
			);
			if ( ! isset( $stored['o'] ) && ! empty( $firing['order'] ) ) {
				$stored['o'] = array(
					'id' => (int) $firing['order'],
					'at' => self::unix( (string) ( $firing['order_at'] ?? '' ) ),
					'v'  => round( (float) ( $firing['value'] ?? 0 ), 2 ),
				);
			}
		}
		return $stored['f'] ? (string) wp_json_encode( $stored ) : '';
	}

	/**
	 * A row's firings back in the named shape, `order`, `order_at` and `value` on every `fired`
	 * entry when the row was credited.
	 *
	 * @since 0.31.0
	 *
	 * @param string|null $json The `firings` column.
	 * @return array<int, array<string, mixed>>
	 */
	public static function unpack_firings( ?string $json ): array {
		$stored = json_decode( (string) $json, true );
		if ( ! is_array( $stored ) || ! is_array( $stored['f'] ?? null ) ) {
			return array();
		}
		$kinds = array_flip( self::FIRING_KIND_CODES );
		$order = is_array( $stored['o'] ?? null ) ? $stored['o'] : null;
		$out   = array();
		foreach ( $stored['f'] as $tuple ) {
			if ( ! is_array( $tuple ) || count( $tuple ) < 6 ) {
				continue;
			}
			$firing = array(
				'rule'   => (string) $tuple[0],
				'action' => (string) $tuple[1],
				'step'   => (int) $tuple[2],
				's'      => (int) $tuple[3],
				'kind'   => $kinds[ (int) $tuple[4] ] ?? 'fired',
				'at'     => gmdate( 'Y-m-d H:i:s', (int) $tuple[5] ),
			);
			if ( null !== $order && 'fired' === $firing['kind'] ) {
				$firing['order']    = (int) ( $order['id'] ?? 0 );
				$firing['order_at'] = gmdate( 'Y-m-d H:i:s', (int) ( $order['at'] ?? 0 ) );
				$firing['value']    = (float) ( $order['v'] ?? 0 );
			}
			$out[] = $firing;
		}
		return $out;
	}

	/**
	 * A SQL UTC datetime as Unix seconds, now when empty.
	 *
	 * @since 0.31.0
	 *
	 * @param string $datetime `Y-m-d H:i:s`.
	 * @return int
	 */
	private static function unix( string $datetime ): int {
		return '' === $datetime ? time() : (int) strtotime( $datetime . ' UTC' );
	}

	/**
	 * Insert a row as given, for seeds and tests: `journey_id` and `visitor` as UUID strings, the
	 * journey in kind names, firings in the named shape, `data` an array or JSON, the times SQL UTC
	 * (`last_seen` defaults to `started_at`). False when an id is not a UUID or the insert fails.
	 *
	 * @since 0.31.0
	 *
	 * @param array $row The columns to write.
	 * @return bool
	 */
	public static function insert_row( array $row ): bool {
		global $wpdb;
		$journey_id = self::hex( (string) ( $row['journey_id'] ?? '' ) );
		$visitor    = self::hex( (string) ( $row['visitor'] ?? '' ) );
		if ( '' === $journey_id || '' === $visitor ) {
			return false;
		}
		$journey    = (string) ( $row['journey'] ?? '' );
		$started_at = (string) ( $row['started_at'] ?? self::now() );
		$data       = $row['data'] ?? null;
		$data       = is_array( $data ) ? self::encode_data( $data ) : (string) $data;
		$firings    = $row['firings'] ?? null;
		$firings    = is_array( $firings ) ? self::pack_firings( $firings ) : (string) $firings;
		$columns    = array(
			'journey_id' => array( 'UNHEX(%s)', $journey_id ),
			'visitor'    => array( 'UNHEX(%s)', $visitor ),
			'user_id'    => (int) ( $row['user_id'] ?? 0 ) > 0 ? array( '%d', (int) $row['user_id'] ) : null,
			'ref'        => '' !== (string) ( $row['ref'] ?? '' ) ? array( '%s', (string) $row['ref'] ) : null,
			'journey'    => array( '%s', self::pack_journey( $journey ) ),
			'steps'      => array( '%d', (int) ( $row['steps'] ?? ( '' === $journey ? 0 : substr_count( $journey, '>' ) + 1 ) ) ),
			'outcome'    => array( '%s', (string) ( $row['outcome'] ?? 'open' ) ),
			'value'      => isset( $row['value'] ) ? array( '%f', (float) $row['value'] ) : null,
			'data'       => '' !== $data ? array( '%s', $data ) : null,
			'started_at' => array( '%s', $started_at ),
			'last_seen'  => array( '%s', (string) ( $row['last_seen'] ?? $started_at ) ),
			'firings'    => '' !== $firings ? array( '%s', $firings ) : null,
		);
		$names      = array();
		$holders    = array();
		$values     = array();
		foreach ( $columns as $name => $spec ) {
			if ( null === $spec ) {
				continue;
			}
			$names[]   = $name;
			$holders[] = $spec[0];
			$values[]  = $spec[1];
		}
		return 1 === (int) $wpdb->query(
			$wpdb->prepare(
				'INSERT INTO ' . self::table() . ' (' . implode( ', ', $names ) . ') VALUES (' . implode( ', ', $holders ) . ')',
				...$values
			)
		);
	}

	/**
	 * Whether a journey id may take a row: one on file always may, a new one only while the visitor
	 * id has started fewer than NEW_PER_HOUR (`wpsignal_journeys_per_hour`) in the last hour.
	 *
	 * @since 0.31.0
	 *
	 * @param string $visitor    The visitor id, as `hex()` gives it.
	 * @param string $journey_id The journey, as `hex()` gives it.
	 * @return bool
	 */
	private function may_start( string $visitor, string $journey_id ): bool {
		global $wpdb;
		if ( '' === $visitor || '' === $journey_id ) {
			return false;
		}
		if ( '' !== (string) $wpdb->get_var( $wpdb->prepare( 'SELECT 1 FROM ' . self::table() . ' WHERE journey_id = UNHEX(%s)', $journey_id ) ) ) {
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
				'SELECT COUNT(*) FROM ' . self::table() . ' WHERE visitor = UNHEX(%s) AND started_at >= %s',
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
	 * @return array{ref: string, value: float|null, data: string}
	 */
	private function record_of( array $report ): array {
		/**
		 * Filters what a journey row keeps of a visit or leave report beyond the journey itself:
		 * `ref`, an extension's own id for what the visitor carries (ShopSocket's cart id, up to 32
		 * characters of `[A-Za-z0-9_-]`), `value`, what it is worth, and `data`, the extension's
		 * own facts about it (ShopSocket: the cart's items and currency), an array stored as JSON
		 * of at most MAX_DATA_BYTES, kept on the row until a later report replaces it.
		 *
		 * @since 0.31.0
		 *
		 * @param array{ref: string, value: float|null, data: array} $record Empty to begin with.
		 * @param array                                                $report The report, as `wpsignal_visitor_visit` hands it.
		 */
		$record = (array) apply_filters(
			'wpsignal_journey_record',
			array(
				'ref'   => '',
				'value' => null,
				'data'  => array(),
			),
			$report
		);
		$ref    = (string) ( $record['ref'] ?? '' );
		return array(
			'ref'   => 1 === preg_match( self::REF_PATTERN, $ref ) ? $ref : '',
			'value' => isset( $record['value'] ) && is_numeric( $record['value'] ) ? round( (float) $record['value'], 4 ) : null,
			'data'  => self::encode_data( $record['data'] ?? null ),
		);
	}

	/**
	 * An extension's `data` as the JSON the row stores: '' for nothing, an empty array, or more than
	 * MAX_DATA_BYTES.
	 *
	 * @since 0.31.0
	 *
	 * @param mixed $data What the filter returned.
	 * @return string
	 */
	private static function encode_data( $data ): string {
		if ( ! is_array( $data ) || empty( $data ) ) {
			return '';
		}
		$json = wp_json_encode( $data );
		return is_string( $json ) && strlen( $json ) <= self::MAX_DATA_BYTES ? $json : '';
	}

	/**
	 * Write a visit or leave report: the first report creates the row, a later one from the same
	 * visitor that is at least as far along updates it, and a visit that creates a row marks the
	 * visitor's other open journeys incomplete. A journey an extension ended keeps its outcome,
	 * value and data; a report's `ago` dates it. Hooked at priority 5, so an extension on the
	 * default priority reads the written row.
	 *
	 * @since 0.31.0
	 *
	 * @param array $report `{ visitor, journey_id, journey, steps, user_id, data, leaving, ago }`.
	 * @return void
	 */
	public function on_report( array $report ): void {
		global $wpdb;
		if ( ! $this->enabled() ) {
			return;
		}
		$journey_id = self::hex( (string) $report['journey_id'] );
		$visitor    = self::hex( (string) $report['visitor'] );
		if ( ! $this->may_start( $visitor, $journey_id ) ) {
			return;
		}
		$leaving = (bool) $report['leaving'];
		$record  = $this->record_of( $report );
		$ago     = max( 0, (int) ( $report['ago'] ?? 0 ) );
		$now     = self::now( $ago );
		$started = self::now( $ago + self::duration( (string) $report['journey'] ) );
		$owned   = 'visitor = VALUES(visitor)';
		$ahead   = $owned . ' AND VALUES(steps) >= steps';
		$final   = "outcome NOT IN ('" . implode( "', '", self::NOT_FINAL ) . "')";
		$wpdb->query(
			$wpdb->prepare(
				'INSERT INTO ' . self::table() . " (journey_id, visitor, user_id, ref, journey, steps, outcome, value, data, started_at, last_seen)
				VALUES (UNHEX(%s), UNHEX(%s), IF(%d > 0, %d, NULL), NULLIF(%s, ''), %s, %d, %s, IF(%d = 1, %f, NULL), NULLIF(%s, ''), %s, %s)
				ON DUPLICATE KEY UPDATE
					user_id = IF(" . $owned . ' AND VALUES(user_id) IS NOT NULL, VALUES(user_id), user_id),
					ref = IF(' . $owned . ' AND VALUES(ref) IS NOT NULL, VALUES(ref), ref),
					value = IF(' . $owned . ' AND VALUES(value) IS NOT NULL AND NOT (' . $final . '), VALUES(value), value),
					data = IF(' . $owned . ' AND VALUES(data) IS NOT NULL AND NOT (' . $final . '), VALUES(data), data),
					last_seen = IF(' . $ahead . ', VALUES(last_seen), last_seen),
					journey = IF(' . $ahead . ', VALUES(journey), journey),
					outcome = IF(' . $final . ' OR NOT (' . $ahead . '), outcome, VALUES(outcome)),
					steps = IF(' . $owned . ', GREATEST(steps, VALUES(steps)), steps)',
				$journey_id,
				$visitor,
				(int) ( $report['user_id'] ?? 0 ),
				(int) ( $report['user_id'] ?? 0 ),
				$record['ref'],
				self::pack_journey( (string) $report['journey'] ),
				(int) $report['steps'],
				$leaving ? 'left' : 'open',
				null === $record['value'] ? 0 : 1,
				(float) $record['value'],
				$record['data'],
				$started,
				$now
			)
		);
		// An insert affects one row, an update two: only a journey's first report marks the others.
		if ( $leaving || 1 !== (int) $wpdb->rows_affected ) {
			return;
		}
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE ' . self::table() . " SET outcome = 'incomplete' WHERE visitor = UNHEX(%s) AND journey_id <> UNHEX(%s) AND outcome = 'open'",
				$visitor,
				$journey_id
			)
		);
	}

	/**
	 * Tell the browser when the journey it reported was ended by an extension (`journey: { ended }`),
	 * so the tracker starts a new one for what the visitor does next.
	 *
	 * @since 0.31.0
	 *
	 * @param array $answer The visit answer so far.
	 * @param array $report The report.
	 * @return array
	 */
	public function answer_visit( array $answer, array $report ): array {
		global $wpdb;
		if ( ! $this->enabled() ) {
			return $answer;
		}
		$outcome = (string) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT outcome FROM ' . self::table() . ' WHERE journey_id = UNHEX(%s) AND visitor = UNHEX(%s)',
				self::hex( (string) $report['journey_id'] ),
				self::hex( (string) $report['visitor'] )
			)
		);
		if ( '' !== $outcome && ! in_array( $outcome, self::NOT_FINAL, true ) ) {
			$answer['journey'] = array( 'ended' => true );
		}
		return $answer;
	}

	/**
	 * Start a row with no steps yet, for a firing that arrives before any report has; the next
	 * report fills it in and keeps this start.
	 *
	 * @since 0.31.0
	 *
	 * @param string $visitor    The visitor id, as `hex()` gives it.
	 * @param string $journey_id The journey id, as `hex()` gives it.
	 * @param int    $user_id    The logged-in visitor, or 0.
	 * @return bool Whether the visitor's row exists afterwards.
	 */
	private function start( string $visitor, string $journey_id, int $user_id ): bool {
		global $wpdb;
		if ( ! $this->may_start( $visitor, $journey_id ) ) {
			return false;
		}
		$now = self::now();
		$wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO ' . self::table() . " (journey_id, visitor, user_id, journey, steps, outcome, started_at, last_seen)
				VALUES (UNHEX(%s), UNHEX(%s), IF(%d > 0, %d, NULL), '', 0, 'open', %s, %s)",
				$journey_id,
				$visitor,
				$user_id,
				$user_id,
				$now,
				$now
			)
		);
		return '' !== (string) $wpdb->get_var( $wpdb->prepare( 'SELECT 1 FROM ' . self::table() . ' WHERE journey_id = UNHEX(%s) AND visitor = UNHEX(%s)', $journey_id, $visitor ) );
	}

	/**
	 * Append a firing report to the visitor's journey, starting the row when none exists yet; the
	 * fired route calls this ahead of `wpsignal_rule_fired`.
	 *
	 * @since 0.31.0
	 *
	 * @param array $report `{ visitor, journey_id, rule_id, action, step, s, kind, user_id, data }`.
	 * @return void
	 */
	public function on_fired( array $report ): void {
		global $wpdb;
		if ( ! $this->enabled() ) {
			return;
		}
		$journey_id = self::hex( (string) $report['journey_id'] );
		$visitor    = self::hex( (string) $report['visitor'] );
		if ( '' === $journey_id || '' === $visitor ) {
			return;
		}
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT firings FROM ' . self::table() . ' WHERE journey_id = UNHEX(%s) AND visitor = UNHEX(%s)', $journey_id, $visitor ), ARRAY_A );
		if ( ! is_array( $row ) ) {
			if ( ! $this->start( $visitor, $journey_id, (int) ( $report['user_id'] ?? 0 ) ) ) {
				return;
			}
			$row = array( 'firings' => null );
		}
		$stored = json_decode( (string) ( $row['firings'] ?? '' ), true );
		$stored = is_array( $stored ) && is_array( $stored['f'] ?? null ) ? $stored : array( 'f' => array() );
		$kind   = (string) ( $report['kind'] ?? 'fired' );
		// The tuple: rule, action, step, seconds into it, kind as a number, Unix seconds.
		$stored['f'][] = array(
			(string) $report['rule_id'],
			(string) $report['action'],
			max( 0, (int) $report['step'] ),
			max( 0, (int) ( $report['s'] ?? 0 ) ),
			self::FIRING_KIND_CODES[ $kind ] ?? 0,
			time(),
		);
		$stored['f']   = array_slice( $stored['f'], -self::MAX_FIRINGS );
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE ' . self::table() . ' SET firings = %s WHERE journey_id = UNHEX(%s) AND visitor = UNHEX(%s)',
				wp_json_encode( $stored ),
				$journey_id,
				$visitor
			)
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
	 * @param array      $data    Fields merged over each ended row's `data` (ShopSocket: the order id); a row is left as it was when the merge would pass MAX_DATA_BYTES.
	 * @return int Journeys ended.
	 */
	public function end_by_ref( string $ref, string $outcome, ?float $value = null, array $data = array() ): int {
		global $wpdb;
		if ( ! $this->enabled() || '' === $ref || ! isset( $this->outcomes[ $outcome ] ) ) {
			return 0;
		}
		$now   = self::now();
		$ended = (int) $wpdb->query(
			$wpdb->prepare(
				'UPDATE ' . self::table() . " SET outcome = %s, value = IF(%d = 1, %f, value), last_seen = %s WHERE ref = %s AND outcome = 'open'",
				$outcome,
				null === $value ? 0 : 1,
				(float) $value,
				$now,
				$ref
			)
		);
		if ( $ended < 1 || empty( $data ) ) {
			return $ended;
		}
		/* The rows this call ended: final now, so no report changes their data before the merge lands. */
		$rows = (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT id, data FROM ' . self::table() . ' WHERE ref = %s AND outcome = %s AND last_seen = %s', $ref, $outcome, $now ),
			ARRAY_A
		);
		foreach ( $rows as $row ) {
			$was    = json_decode( (string) ( $row['data'] ?? '' ), true );
			$merged = self::encode_data( array_merge( is_array( $was ) ? $was : array(), $data ) );
			if ( '' !== $merged ) {
				$wpdb->update( self::table(), array( 'data' => $merged ), array( 'id' => (int) $row['id'] ), array( '%s' ), array( '%d' ) );
			}
		}
		return $ended;
	}

	/**
	 * Credit an order to the ref's journeys that a moment fired in within the window, across
	 * journeys, so the Moments tab can say what a moment led to: one order per row, on every
	 * `fired` entry when read; a row already credited keeps its order.
	 *
	 * @since 0.31.0
	 * @since 0.31.0 Credits the row once instead of stamping each firing.
	 *
	 * @param string $ref    The ref.
	 * @param int    $order  The order the ref became.
	 * @param float  $value  The order's value.
	 * @param int    $window Seconds back from now a firing still counts; CREDIT_WINDOW by default.
	 * @return int Firings credited.
	 */
	public function credit( string $ref, int $order, float $value, int $window = self::CREDIT_WINDOW ): int {
		global $wpdb;
		if ( ! $this->enabled() || '' === $ref || $order <= 0 ) {
			return 0;
		}
		$now     = time();
		$since   = $now - max( 0, $window );
		$rows    = (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT id, firings FROM ' . self::table() . ' WHERE ref = %s AND firings IS NOT NULL', $ref ),
			ARRAY_A
		);
		$stamped = 0;
		foreach ( $rows as $row ) {
			$stored = json_decode( (string) $row['firings'], true );
			if ( ! is_array( $stored ) || ! is_array( $stored['f'] ?? null ) || isset( $stored['o'] ) ) {
				continue;
			}
			$within = 0;
			$fired  = self::FIRING_KIND_CODES['fired'];
			foreach ( $stored['f'] as $tuple ) {
				$at   = is_array( $tuple ) ? (int) ( $tuple[5] ?? 0 ) : 0;
				$kind = is_array( $tuple ) ? (int) ( $tuple[4] ?? -1 ) : -1;
				if ( $fired === $kind && $at >= $since ) {
					++$within;
				}
			}
			if ( 0 === $within ) {
				continue;
			}
			$stored['o'] = array(
				'id' => $order,
				'at' => $now,
				'v'  => round( $value, 2 ),
			);
			$wpdb->update( self::table(), array( 'firings' => wp_json_encode( $stored ) ), array( 'id' => (int) $row['id'] ), array( '%s' ), array( '%d' ) );
			$stamped += $within;
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
	 * Whether a value is a real `YYYY-MM-DD` day.
	 *
	 * @since 0.31.0
	 *
	 * @param mixed $value The value.
	 * @return bool
	 */
	public static function is_date( $value ): bool {
		return is_string( $value )
			&& 1 === preg_match( self::DATE_PATTERN, $value )
			&& checkdate( (int) substr( $value, 5, 2 ), (int) substr( $value, 8, 2 ), (int) substr( $value, 0, 4 ) );
	}

	/**
	 * The `WHERE` for journeys started between two days on the site's clock, both inclusive, either
	 * optional; `1 = 1` with neither.
	 *
	 * @since 0.31.0
	 *
	 * @param string|null $from The first day, `YYYY-MM-DD`.
	 * @param string|null $to   The last day, `YYYY-MM-DD`.
	 * @return string
	 */
	private static function range_where( ?string $from, ?string $to ): string {
		global $wpdb;
		$tz    = wp_timezone();
		$utc   = new \DateTimeZone( 'UTC' );
		$where = array();
		if ( null !== $from ) {
			$where[] = $wpdb->prepare( 'started_at >= %s', ( new \DateTimeImmutable( $from . ' 00:00:00', $tz ) )->setTimezone( $utc )->format( 'Y-m-d H:i:s' ) );
		}
		if ( null !== $to ) {
			$where[] = $wpdb->prepare( 'started_at < %s', ( new \DateTimeImmutable( $to . ' 00:00:00', $tz ) )->modify( '+1 day' )->setTimezone( $utc )->format( 'Y-m-d H:i:s' ) );
		}
		return $where ? implode( ' AND ', $where ) : '1 = 1';
	}

	/**
	 * How many journeys started between two days on the site's clock, every journey with neither.
	 *
	 * @since 0.31.0
	 *
	 * @param string|null $from The first day, `YYYY-MM-DD`.
	 * @param string|null $to   The last day, `YYYY-MM-DD`.
	 * @return int
	 */
	public function count( ?string $from = null, ?string $to = null ): int {
		global $wpdb;
		return (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::table() . ' WHERE ' . self::range_where( $from, $to ) );
	}

	/**
	 * Delete the journeys started between two days on the site's clock, every journey with neither,
	 * in batches until none is left. Returns how many went.
	 *
	 * @since 0.31.0
	 *
	 * @param string|null $from The first day, `YYYY-MM-DD`.
	 * @param string|null $to   The last day, `YYYY-MM-DD`.
	 * @return int
	 */
	public function purge( ?string $from = null, ?string $to = null ): int {
		global $wpdb;
		$where   = self::range_where( $from, $to );
		$deleted = 0;
		do {
			$batch    = (int) $wpdb->query( 'DELETE FROM ' . self::table() . " WHERE {$where} LIMIT " . self::PRUNE_BATCH );
			$deleted += $batch;
		} while ( $batch >= self::PRUNE_BATCH );
		delete_transient( self::VISUALS_TRANSIENT );
		return $deleted;
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
		$since    = gmdate( 'Y-m-d H:i:s', time() - min( self::FEED_MAX_DAYS, max( 1, $days ) ) * DAY_IN_SECONDS );
		$rows     = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT journey, started_at, outcome, value, ref, firings, data FROM ' . self::table() . ' WHERE started_at >= %s ORDER BY started_at DESC LIMIT %d',
				$since,
				min( self::FEED_MAX_LIMIT, max( 1, $limit ) )
			),
			ARRAY_A
		);
		$journeys = self::unpack_journeys( array_column( $rows, 'journey' ) );
		return array_map(
			static function ( array $row, string $journey ): array {
				$row['journey'] = $journey;
				$entry          = array(
					'journey'    => $journey,
					'started_at' => self::rfc3339( (string) $row['started_at'] ),
					'outcome'    => (string) $row['outcome'],
					'value'      => round( (float) ( $row['value'] ?? 0 ), 2 ),
					'has_ref'    => '' !== (string) ( $row['ref'] ?? '' ),
					'firings'    => self::unpack_firings( $row['firings'] ?? null ),
				);
				/**
				 * Filters the context a stored journey offers the replay, for the conditions an
				 * extension registered (ShopSocket: `cart`, from the row's ref and value).
				 *
				 * @since 0.31.0
				 *
				 * @param array $context Empty to begin with.
				 * @param array $row     The row: `journey` (in kind names), `started_at`, `outcome`, `value`, `ref`, `firings` (as stored), `data` (JSON).
				 */
				$entry['context'] = (array) apply_filters( 'wpsignal_journey_context', array(), $row );
				return $entry;
			},
			$rows,
			$journeys
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
	 * The Journeys tab's figures over the last VISUALS_DAYS days on the site's clock, with the months
	 * that hold journeys, History on or off; a computed answer is kept CACHE_TTL seconds.
	 *
	 * @since 0.31.0
	 *
	 * @return array<string, mixed>|null
	 */
	public function visuals(): ?array {
		$cached = get_transient( self::VISUALS_TRANSIENT );
		if ( is_array( $cached ) ) {
			return $cached;
		}
		list( $tz, $since, $dates ) = self::window();

		$days  = array_fill_keys(
			$dates,
			array(
				'visits'   => 0,
				'left_ref' => 0,
				'outcomes' => array(),
			)
		);
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
		$list  = $this->listed( $since, null, $tz, 0, $hours );
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
			'listed'     => count( $list ),
			'total'      => $total,
			'months'     => $this->months( $tz ),
			'outcomes'   => $this->outcomes(),
			'ref'        => $this->ref,
			'kinds'      => WPS::rules()->kinds(),
			'currency'   => $this->currency(),
		);
		set_transient( self::VISUALS_TRANSIENT, $visuals, self::CACHE_TTL );
		return $visuals;
	}

	/**
	 * One page of a month's journeys for the network, VISUALS_JOURNEYS to a page, newest first, with
	 * the month's total; null for a month that is not `YYYY-MM`.
	 *
	 * @since 0.31.0
	 *
	 * @param string $month The month on the site's clock, `YYYY-MM`.
	 * @param int    $page  The page, 1 the newest.
	 * @return array{journeys: array<int, array<string, mixed>>}|null
	 */
	public function visuals_page( string $month, int $page ): ?array {
		$tz     = wp_timezone();
		$bounds = self::month_bounds( $month, $tz );
		if ( null === $bounds ) {
			return null;
		}
		list( $since, $until ) = $bounds;
		return array(
			'journeys' => $this->listed( $since, $until, $tz, max( 0, $page - 1 ) * self::VISUALS_JOURNEYS ),
		);
	}

	/**
	 * The months on the site's clock that hold journeys, newest first, each `{ month, count }`, from the
	 * month the retention reaches back to.
	 *
	 * @since 0.31.0
	 *
	 * @param \DateTimeZone $tz The site's timezone.
	 * @return array<int, array{month: string, count: int}>
	 */
	private function months( \DateTimeZone $tz ): array {
		global $wpdb;
		$utc    = new \DateTimeZone( 'UTC' );
		$floor  = ( new \DateTimeImmutable( $this->retention_floor(), $utc ) )->setTimezone( $tz )->modify( 'first day of this month midnight' );
		$rows   = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT DATE_FORMAT(started_at, %s) AS h, COUNT(*) AS n FROM ' . self::table() . ' WHERE started_at >= %s GROUP BY h',
				'%Y-%m-%d %H',
				$floor->setTimezone( $utc )->format( 'Y-m-d H:i:s' )
			),
			ARRAY_A
		);
		$counts = array();
		foreach ( $rows as $row ) {
			$month            = ( new \DateTimeImmutable( $row['h'] . ':00:00', $utc ) )->setTimezone( $tz )->format( 'Y-m' );
			$counts[ $month ] = ( $counts[ $month ] ?? 0 ) + (int) $row['n'];
		}
		krsort( $counts );
		$months = array();
		foreach ( $counts as $month => $count ) {
			$months[] = array(
				'month' => $month,
				'count' => $count,
			);
		}
		return $months;
	}

	/**
	 * The oldest moment the retention keeps, as SQL UTC.
	 *
	 * @since 0.31.0
	 *
	 * @return string
	 */
	private function retention_floor(): string {
		return gmdate( 'Y-m-d H:i:s', (int) strtotime( '-' . $this->config->journeys_retention_months() . ' months' ) );
	}

	/**
	 * A `YYYY-MM` month's start and end on the site's clock as SQL UTC, null when it is not one.
	 *
	 * @since 0.31.0
	 *
	 * @param string        $month The month.
	 * @param \DateTimeZone $tz    The site's timezone.
	 * @return array{0: string, 1: string}|null
	 */
	private static function month_bounds( string $month, \DateTimeZone $tz ): ?array {
		if ( ! preg_match( self::MONTH_PATTERN, $month ) ) {
			return null;
		}
		$utc   = new \DateTimeZone( 'UTC' );
		$start = new \DateTimeImmutable( $month . '-01 00:00:00', $tz );
		return array(
			$start->setTimezone( $utc )->format( 'Y-m-d H:i:s' ),
			$start->modify( '+1 month' )->setTimezone( $utc )->format( 'Y-m-d H:i:s' ),
		);
	}

	/**
	 * The visuals' window: the site's timezone, its start as SQL UTC, and its local dates, oldest first.
	 *
	 * @since 0.31.0
	 *
	 * @return array{0: \DateTimeZone, 1: string, 2: string[]}
	 */
	private static function window(): array {
		$tz    = wp_timezone();
		$start = ( new \DateTimeImmutable( 'now', $tz ) )->setTime( 0, 0 )->sub( new \DateInterval( 'P' . ( self::VISUALS_DAYS - 1 ) . 'D' ) );
		$dates = array();
		for ( $i = 0; $i < self::VISUALS_DAYS; $i++ ) {
			$dates[] = $start->add( new \DateInterval( 'P' . $i . 'D' ) )->format( 'Y-m-d' );
		}
		return array( $tz, $start->setTimezone( new \DateTimeZone( 'UTC' ) )->format( 'Y-m-d H:i:s' ), $dates );
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
	 * VISUALS_JOURNEYS journeys started from `$since` up to `$until` (or ever) from an offset, newest first,
	 * pouring their time on the site into the grid's minutes when a grid is given.
	 *
	 * @since 0.31.0
	 *
	 * @param string        $since  Range start, SQL UTC.
	 * @param string|null   $until  Range end, SQL UTC, exclusive; null for no end.
	 * @param \DateTimeZone $tz     The site's timezone.
	 * @param int           $offset Journeys to skip.
	 * @param array|null    $hours  Weekday by hour cells, minutes added in place.
	 * @return array<int, array<string, mixed>>
	 */
	private function listed( string $since, ?string $until, \DateTimeZone $tz, int $offset = 0, ?array &$hours = null ): array {
		global $wpdb;
		$rows     = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT journey, started_at, outcome, ref, value FROM ' . self::table() . ' WHERE started_at >= %s AND started_at < %s ORDER BY started_at DESC, id DESC LIMIT %d OFFSET %d',
				$since,
				$until ?? '9999-12-31 23:59:59',
				self::VISUALS_JOURNEYS,
				$offset
			),
			ARRAY_A
		);
		$journeys = self::unpack_journeys( array_column( $rows, 'journey' ) );
		$list     = array();
		foreach ( $rows as $i => $row ) {
			$list[] = array(
				'journey'    => $journeys[ $i ],
				'started_at' => self::rfc3339( (string) $row['started_at'] ),
				'outcome'    => (string) $row['outcome'],
				'has_ref'    => '' !== (string) ( $row['ref'] ?? '' ),
				'value'      => round( (float) ( $row['value'] ?? 0 ), 2 ),
			);
			if ( null !== $hours ) {
				self::pour( $journeys[ $i ], (int) strtotime( $row['started_at'] . ' UTC' ), $tz, $hours );
			}
		}
		return $list;
	}

	/**
	 * Add a journey's time on the site to the cells it fell in, each step counted for at most
	 * MAX_STEP_SECONDS; `away` steps advance the clock and add nothing.
	 *
	 * @since 0.31.0
	 *
	 * @param string        $journey The `kind:id:s` steps.
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
			list( $kind, , $s ) = array_pad( explode( ':', $step ), 3, '0' );
			$left               = min( self::MAX_STEP_SECONDS, max( 0, (int) $s ) );
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
	 * Mark the open journeys nobody has reported on for STALE_SECONDS incomplete, then delete journeys
	 * past the retention, History on or off, in batches for at most PRUNE_SECONDS.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function prune(): void {
		global $wpdb;
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE ' . self::table() . " SET outcome = 'incomplete' WHERE outcome = 'open' AND started_at >= %s AND started_at < %s AND last_seen < %s",
				self::now( self::STALE_SCAN_SECONDS ),
				self::now( self::STALE_SECONDS ),
				self::now( self::STALE_SECONDS )
			)
		);
		$where = $wpdb->prepare( 'started_at < %s', $this->retention_floor() );
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
			$rows     = (array) $wpdb->get_results(
				$wpdb->prepare( 'SELECT HEX(journey_id) AS journey_id, journey, outcome, value, started_at, last_seen, data FROM ' . self::table() . ' WHERE user_id = %d ORDER BY started_at', $user->ID ),
				ARRAY_A
			);
			$journeys = self::unpack_journeys( array_column( $rows, 'journey' ) );
			foreach ( $rows as $i => $row ) {
				$data[] = array(
					'group_id'    => 'wpsignal_journeys',
					'group_label' => __( 'WordSocket journeys', 'wordsocket' ),
					'item_id'     => 'wpsignal-journey-' . self::uuid( (string) $row['journey_id'] ),
					'data'        => array(
						array(
							'name'  => __( 'Started', 'wordsocket' ),
							'value' => (string) $row['started_at'],
						),
						array(
							'name'  => __( 'Ended', 'wordsocket' ),
							'value' => in_array( (string) $row['outcome'], array( 'open', 'incomplete' ), true ) ? '' : (string) $row['last_seen'],
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
							'value' => $journeys[ $i ],
						),
						array(
							'name'  => __( 'Details', 'wordsocket' ),
							'value' => (string) ( $row['data'] ?? '' ),
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
				'<p>' . __( 'With journey history on, WordSocket keeps the pages each visitor opened on this site and how long they stayed on each, as page ids and durations under a random browser id, for the number of months set in its settings. An extension may add what the visit carried (ShopSocket: the contents of the cart and the order it became). The record is linked to your account for the visits you were logged in. Nothing of this leaves the site, and the privacy tools here can export and erase what is linked to an account; the visits of someone who was not logged in are known only by that random id.', 'wordsocket' ) . '</p>'
			)
		);
	}

	/**
	 * Register `GET /wpsignal/v1/journeys` (the replay's feed), `DELETE /wpsignal/v1/journeys` (the purge), `/journeys/visuals` and `/journeys/visuals/journeys` (the Journeys tab).
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function register_routes(): void {
		$staff   = static fn() => current_user_can( 'manage_options' );
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
		$is_date = static fn( $value ): bool => self::is_date( $value );
		register_rest_route(
			'wpsignal/v1',
			'/journeys',
			array(
				'methods'             => 'DELETE',
				'args'                => array(
					'from' => array(
						'type'              => 'string',
						'validate_callback' => $is_date,
					),
					'to'   => array(
						'type'              => 'string',
						'validate_callback' => $is_date,
					),
				),
				'callback'            => function ( WP_REST_Request $request ) {
					$from = $request->get_param( 'from' );
					$to   = $request->get_param( 'to' );
					$from = is_string( $from ) ? $from : null;
					$to   = is_string( $to ) ? $to : null;
					if ( null !== $from && null !== $to && $from > $to ) {
						return new \WP_Error( 'wpsignal_invalid_range', __( 'The first day is after the last.', 'wordsocket' ), array( 'status' => 400 ) );
					}
					return rest_ensure_response( array( 'deleted' => $this->purge( $from, $to ) ) );
				},
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
		register_rest_route(
			'wpsignal/v1',
			'/journeys/visuals/journeys',
			array(
				'methods'             => 'GET',
				'args'                => array(
					'month' => array(
						'type'              => 'string',
						'required'          => true,
						'validate_callback' => fn( $value ) => is_string( $value ) && 1 === preg_match( self::MONTH_PATTERN, $value ),
					),
					'page'  => array(
						'type'     => 'integer',
						'required' => true,
						'minimum'  => 1,
						'maximum'  => 1000,
					),
				),
				'callback'            => fn( WP_REST_Request $request ) => rest_ensure_response(
					$this->visuals_page( (string) $request->get_param( 'month' ), (int) $request->get_param( 'page' ) )
				),
				'permission_callback' => $staff,
			)
		);
	}
}
