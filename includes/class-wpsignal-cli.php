<?php
/**
 * WPSignal\Cli: WordSocket's WP-CLI commands.
 *
 * - `wp wordsocket journeys list` prints stored journeys, newest first, with filters for the visitor, user, ref, outcome and moment; `--raw` prints the rows as the table holds them, kind codes and all.
 * - `wp wordsocket journeys get <journey_id>` prints one journey step by step with every firing on it.
 * - `wp wordsocket journeys seed [--count=<n>] [--months=<n>]` fills the journeys table with made-up visits for a look at the Journeys tab.
 * - `wp wordsocket journeys unseed` deletes them again.
 * - `wp wordsocket journeys purge [--from=<date>] [--to=<date>] [--yes]` deletes stored journeys, every one or those started between two days on the site's clock, after a confirmation.
 * - Seeded visitor ids start with `5eed0000-`, which no browser makes, so only seeded rows are ever removed and `list` leaves them out unless asked.
 * - Rows hold ids as 16 bytes and journeys and firings in their stored shapes; every read goes through `Journeys` to print names and UUIDs.
 * - Seeding refuses a production environment (`wp_get_environment_type()`).
 *
 * @package WordSocket
 */

namespace WPSignal;

use WP_CLI;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, WordPress.WP.AlternativeFunctions.rand_mt_rand, WordPress.WP.AlternativeFunctions.rand_seeding_mt_srand

/**
 * Lists, shows, seeds and clears journeys.
 *
 * @since 0.31.0
 */
class Cli {

	/**
	 * Journeys seeded when `--count` is not given.
	 *
	 * @since 0.31.0
	 */
	const DEFAULT_COUNT = 300;

	/**
	 * Most journeys one seed call creates.
	 *
	 * @since 0.31.0
	 */
	const MAX_COUNT = 5000;

	/**
	 * Journeys listed when `--count` is not given.
	 *
	 * @since 0.31.0
	 */
	const LIST_COUNT = 20;

	/**
	 * Most journeys one list call prints.
	 *
	 * @since 0.31.0
	 */
	const LIST_MAX_COUNT = 1000;

	/**
	 * Days `journeys list` reaches back by default.
	 *
	 * @since 0.31.0
	 */
	const LIST_DAYS = 28;

	/**
	 * The columns `list` prints by default, in order.
	 *
	 * @since 0.31.0
	 */
	const LIST_FIELDS = array( 'journey_id', 'started_at', 'visitor', 'user_id', 'outcome', 'value', 'ref', 'steps', 'firings', 'path' );

	/**
	 * The columns `list --raw` prints by default, in order.
	 *
	 * @since 0.31.0
	 */
	const LIST_RAW_FIELDS = array( 'journey_id', 'started_at', 'visitor', 'user_id', 'outcome', 'value', 'ref', 'steps', 'journey', 'firings' );

	/**
	 * The visitor ids seeded journeys start with.
	 *
	 * @since 0.31.0
	 */
	const SEED_PREFIX = '5eed0000-';

	/**
	 * Register the commands when WP-CLI is running.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public static function register(): void {
		if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
			return;
		}
		$cli = new self();
		WP_CLI::add_command(
			'wordsocket journeys list',
			array( $cli, 'list' ),
			array(
				'shortdesc' => 'List stored journeys, newest first.',
				'synopsis'  => array(
					array(
						'type'        => 'assoc',
						'name'        => 'count',
						'description' => 'How many journeys to list.',
						'optional'    => true,
						'default'     => (string) self::LIST_COUNT,
					),
					array(
						'type'        => 'assoc',
						'name'        => 'days',
						'description' => 'How many days back to look.',
						'optional'    => true,
						'default'     => (string) self::LIST_DAYS,
					),
					array(
						'type'        => 'assoc',
						'name'        => 'user',
						'description' => 'Only journeys written while this user id was logged in.',
						'optional'    => true,
					),
					array(
						'type'        => 'assoc',
						'name'        => 'visitor',
						'description' => 'Only this visitor id.',
						'optional'    => true,
					),
					array(
						'type'        => 'assoc',
						'name'        => 'ref',
						'description' => 'Only journeys carrying this ref, such as a cart id.',
						'optional'    => true,
					),
					array(
						'type'        => 'assoc',
						'name'        => 'outcome',
						'description' => 'Only journeys with this outcome: open, left, incomplete, or one an extension registered.',
						'optional'    => true,
					),
					array(
						'type'        => 'assoc',
						'name'        => 'rule',
						'description' => 'Only journeys on which this moment id fired.',
						'optional'    => true,
					),
					array(
						'type'        => 'flag',
						'name'        => 'fired',
						'description' => 'Only journeys with at least one firing.',
						'optional'    => true,
					),
					array(
						'type'        => 'flag',
						'name'        => 'seeded',
						'description' => 'Include the journeys the seed command made.',
						'optional'    => true,
					),
					array(
						'type'        => 'flag',
						'name'        => 'raw',
						'description' => 'Print the rows as the table holds them: ids as hex, the journey in kind codes, firings and data as stored.',
						'optional'    => true,
					),
					array(
						'type'        => 'assoc',
						'name'        => 'fields',
						'description' => 'Comma-separated columns to print. Also: last_seen, journey, data.',
						'optional'    => true,
					),
					array(
						'type'        => 'assoc',
						'name'        => 'format',
						'description' => 'Output format.',
						'optional'    => true,
						'default'     => 'table',
						'options'     => array( 'table', 'json', 'csv', 'yaml', 'count', 'ids' ),
					),
				),
			)
		);
		WP_CLI::add_command(
			'wordsocket journeys get',
			array( $cli, 'get' ),
			array(
				'shortdesc' => 'Show one journey: its row, its steps and every firing on it.',
				'synopsis'  => array(
					array(
						'type'        => 'positional',
						'name'        => 'journey_id',
						'description' => 'The journey id.',
					),
					array(
						'type'        => 'assoc',
						'name'        => 'format',
						'description' => 'Output format.',
						'optional'    => true,
						'default'     => 'table',
						'options'     => array( 'table', 'json' ),
					),
				),
			)
		);
		WP_CLI::add_command(
			'wordsocket journeys seed',
			array( $cli, 'seed' ),
			array(
				'shortdesc' => 'Fill the journeys table with made-up visits spread over the last months, for a look at the Journeys tab.',
				'synopsis'  => array(
					array(
						'type'        => 'assoc',
						'name'        => 'count',
						'description' => 'How many journeys to seed.',
						'optional'    => true,
						'default'     => (string) self::DEFAULT_COUNT,
					),
					array(
						'type'        => 'assoc',
						'name'        => 'months',
						'description' => 'How many months back to spread them, at most the retention. Defaults to the retention.',
						'optional'    => true,
					),
				),
			)
		);
		WP_CLI::add_command(
			'wordsocket journeys unseed',
			array( $cli, 'unseed' ),
			array( 'shortdesc' => 'Delete the journeys the seed command made.' )
		);
		WP_CLI::add_command(
			'wordsocket journeys purge',
			array( $cli, 'purge' ),
			array(
				'shortdesc' => 'Delete stored journeys: every one, or those started between two days on the site\'s clock.',
				'synopsis'  => array(
					array(
						'type'        => 'assoc',
						'name'        => 'from',
						'description' => 'The first day, YYYY-MM-DD, on the site\'s clock.',
						'optional'    => true,
					),
					array(
						'type'        => 'assoc',
						'name'        => 'to',
						'description' => 'The last day, YYYY-MM-DD, inclusive.',
						'optional'    => true,
					),
					array(
						'type'        => 'flag',
						'name'        => 'yes',
						'description' => 'Skip the confirmation.',
						'optional'    => true,
					),
				),
			)
		);
	}

	/**
	 * List stored journeys, newest first, as a table, JSON, CSV, YAML, a count or ids.
	 *
	 * @since 0.31.0
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args `count`, `days`, `user`, `visitor`, `ref`, `outcome`, `rule`, `fired`, `seeded`, `raw`, `fields`, `format`.
	 * @return void
	 */
	public function list( array $args, array $assoc_args ): void {
		unset( $args );
		$count = (int) ( $assoc_args['count'] ?? self::LIST_COUNT );
		if ( $count < 1 || $count > self::LIST_MAX_COUNT ) {
			WP_CLI::error( sprintf( '--count must be between 1 and %d.', self::LIST_MAX_COUNT ) );
		}
		$days = (int) ( $assoc_args['days'] ?? self::LIST_DAYS );
		if ( $days < 1 ) {
			WP_CLI::error( '--days must be at least 1.' );
		}
		$format = (string) ( $assoc_args['format'] ?? 'table' );
		$query  = array(
			'days'  => $days,
			'limit' => $count,
		);
		foreach ( array( 'user', 'visitor', 'ref', 'outcome', 'rule', 'fired' ) as $key ) {
			if ( isset( $assoc_args[ $key ] ) ) {
				$query[ $key ] = $assoc_args[ $key ];
			}
		}
		if ( empty( $assoc_args['seeded'] ) ) {
			$query['exclude_visitor_prefix'] = self::SEED_PREFIX;
		}
		if ( 'count' === $format ) {
			$total = Journeys::query_count( $query );
			if ( is_wp_error( $total ) ) {
				WP_CLI::error( $total->get_error_message() );
			}
			WP_CLI::line( (string) $total );
			return;
		}
		$raw     = ! empty( $assoc_args['raw'] );
		$records = $raw ? Journeys::query_rows( $query ) : Journeys::query( $query );
		if ( is_wp_error( $records ) ) {
			WP_CLI::error( $records->get_error_message() );
		}
		$fields = isset( $assoc_args['fields'] ) ? array_map( 'trim', explode( ',', (string) $assoc_args['fields'] ) ) : ( $raw ? self::LIST_RAW_FIELDS : self::LIST_FIELDS );
		if ( 'ids' === $format ) {
			$records = array_column( $records, 'journey_id' );
		} elseif ( ! $raw ) {
			$records = array_map( array( $this, 'listed' ), $records );
		}
		\WP_CLI\Utils\format_items( $format, $records, $fields );
	}

	/**
	 * A record as the `list` table prints it: the path cut short, the firings their count, the data as JSON.
	 *
	 * @since 0.31.0
	 *
	 * @param array $record A record from `Journeys::query()`.
	 * @return array
	 */
	public function listed( array $record ): array {
		$record['firings'] = count( $record['firings'] );
		$record['path']    = strlen( $record['path'] ) > 60 ? substr( $record['path'], 0, 57 ) . '...' : $record['path'];
		$record['value']   = null === $record['value'] ? '' : $record['value'];
		$record['data']    = null === $record['data'] ? '' : (string) wp_json_encode( $record['data'] );
		return $record;
	}

	/**
	 * Rows as the table holds them, with the ids as UUIDs and the journeys in kind names.
	 *
	 * @since 0.31.0
	 *
	 * @param array<int, array<string, mixed>> $rows Rows selected with COLUMNS.
	 * @return array<int, array<string, mixed>>
	 */
	private static function named( array $rows ): array {
		$journeys = Journeys::unpack_journeys( array_column( $rows, 'journey' ) );
		foreach ( $rows as $i => $row ) {
			$rows[ $i ]['journey_id'] = Journeys::uuid( (string) $row['journey_id'] );
			$rows[ $i ]['visitor']    = Journeys::uuid( (string) $row['visitor'] );
			$rows[ $i ]['journey']    = $journeys[ $i ];
		}
		return $rows;
	}

	/**
	 * Show one journey: its row, then each step with what the page was, then each firing with the moment it belongs to.
	 *
	 * @since 0.31.0
	 *
	 * @param array $args       `journey_id`.
	 * @param array $assoc_args `format`.
	 * @return void
	 */
	public function get( array $args, array $assoc_args ): void {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT ' . Journeys::QUERY_COLUMNS . ' FROM ' . Journeys::table() . ' WHERE journey_id = UNHEX(%s)', Journeys::hex( (string) $args[0] ) ), ARRAY_A );
		if ( ! is_array( $row ) ) {
			WP_CLI::error( sprintf( 'No journey %s.', $args[0] ) );
		}
		$row     = self::named( array( $row ) )[0];
		$steps   = $this->steps( (string) $row['journey'] );
		$firings = $this->firings( (string) ( $row['firings'] ?? '' ) );
		$data    = json_decode( (string) ( $row['data'] ?? '' ), true );
		$summary = $this->summary( $row, false );
		unset( $summary['firings'], $summary['path'], $summary['data'] );
		if ( 'json' === ( $assoc_args['format'] ?? 'table' ) ) {
			WP_CLI::line(
				(string) wp_json_encode(
					array(
						'journey' => $summary,
						'steps'   => $steps,
						'firings' => $firings,
						'data'    => is_array( $data ) ? $data : null,
					),
					JSON_PRETTY_PRINT
				)
			);
			return;
		}
		unset( $summary['journey'] );
		\WP_CLI\Utils\format_items( 'table', array( $summary ), array_keys( $summary ) );
		WP_CLI::line( '' );
		WP_CLI::line( sprintf( 'Steps (%d, oldest first):', count( $steps ) ) );
		\WP_CLI\Utils\format_items( 'table', $steps, array( 'step', 'kind', 'id', 'what', 'time' ) );
		WP_CLI::line( '' );
		if ( ! $firings ) {
			WP_CLI::line( 'Firings: none.' );
		} else {
			WP_CLI::line( sprintf( 'Firings (%d):', count( $firings ) ) );
			\WP_CLI\Utils\format_items( 'table', $firings, array( 'at', 'moment', 'action', 'kind', 'step', 'after', 'order', 'value' ) );
		}
		if ( is_array( $data ) && $data ) {
			WP_CLI::line( '' );
			WP_CLI::line( 'Data: ' . wp_json_encode( $data, JSON_PRETTY_PRINT ) );
		}
	}

	/**
	 * One row as the columns `list` prints, the path a short walk of kinds and the firings their count.
	 *
	 * @since 0.31.0
	 *
	 * @param array $row   The row.
	 * @param bool  $short Whether to cut the path short and count the firings instead of listing them.
	 * @return array
	 */
	public function summary( array $row, bool $short = true ): array {
		$firings = Journeys::unpack_firings( $row['firings'] ?? null );
		$kinds   = array_map( static fn( string $step ): string => explode( ':', $step )[0], array_filter( explode( '>', (string) $row['journey'] ) ) );
		$path    = implode( ' > ', $kinds );
		return array(
			'journey_id' => (string) $row['journey_id'],
			'started_at' => (string) $row['started_at'],
			'last_seen'  => (string) $row['last_seen'],
			'visitor'    => (string) $row['visitor'],
			'user_id'    => (int) ( $row['user_id'] ?? 0 ),
			'outcome'    => (string) $row['outcome'],
			'value'      => null === $row['value'] ? '' : (float) $row['value'],
			'ref'        => (string) ( $row['ref'] ?? '' ),
			'steps'      => (int) $row['steps'],
			'firings'    => $short ? count( $firings ) : $firings,
			'path'       => $short && strlen( $path ) > 60 ? substr( $path, 0, 57 ) . '...' : $path,
			'journey'    => (string) $row['journey'],
			'data'       => (string) ( $row['data'] ?? '' ),
		);
	}

	/**
	 * A journey's steps, numbered from 1, each with the page's title or term name where the kind has one.
	 *
	 * @since 0.31.0
	 *
	 * @param string $journey The `kind:id:s` steps joined by `>`.
	 * @return array<int, array{step: int, kind: string, id: int, what: string, time: string}>
	 */
	private function steps( string $journey ): array {
		$taxonomies = WPS::rules()->taxonomy_kinds();
		$steps      = array();
		foreach ( array_values( array_filter( explode( '>', $journey ) ) ) as $i => $step ) {
			list( $kind, $id, $s ) = array_pad( explode( ':', $step ), 3, '0' );
			$id                    = (int) $id;
			$what                  = '';
			if ( 'away' === $kind ) {
				$what = 'tab hidden';
			} elseif ( $id && in_array( $kind, $taxonomies, true ) ) {
				$term = get_term( $id );
				$what = $term instanceof \WP_Term ? $term->name : '';
			} elseif ( $id && post_type_exists( $kind ) ) {
				$what = get_the_title( $id );
			}
			$steps[] = array(
				'step' => $i + 1,
				'kind' => $kind,
				'id'   => $id,
				'what' => $what,
				'time' => self::seconds( (int) $s ),
			);
		}
		return $steps;
	}

	/**
	 * A row's firings with the moment named from the saved rules and the time into the step as seconds.
	 *
	 * @since 0.31.0
	 *
	 * @param string $json The row's `firings` column.
	 * @return array<int, array{at: string, moment: string, action: string, kind: string, step: int, after: string, order: string, value: string}>
	 */
	private function firings( string $json ): array {
		$firings = Journeys::unpack_firings( $json );
		if ( ! $firings ) {
			return array();
		}
		$names = array();
		foreach ( WPS::rules()->saved()['rules'] as $rule ) {
			$names[ (string) $rule['id'] ] = (string) ( $rule['name'] ?? '' );
		}
		return array_map(
			static function ( array $firing ) use ( $names ): array {
				$rule = (string) ( $firing['rule'] ?? '' );
				return array(
					'at'     => (string) ( $firing['at'] ?? '' ),
					'moment' => isset( $names[ $rule ] ) && '' !== $names[ $rule ] ? "{$names[ $rule ]} ({$rule})" : $rule,
					'action' => (string) ( $firing['action'] ?? '' ),
					'kind'   => (string) ( $firing['kind'] ?? 'fired' ),
					'step'   => (int) ( $firing['step'] ?? 0 ),
					'after'  => self::seconds( (int) ( $firing['s'] ?? 0 ) ),
					'order'  => isset( $firing['order'] ) ? (string) $firing['order'] : '',
					'value'  => isset( $firing['value'] ) ? (string) $firing['value'] : '',
				);
			},
			$firings
		);
	}

	/**
	 * Seconds as "12 s", minutes past 90 s.
	 *
	 * @since 0.31.0
	 *
	 * @param int $seconds Whole seconds.
	 * @return string
	 */
	private static function seconds( int $seconds ): string {
		if ( $seconds >= 90 ) {
			return sprintf( '%d min', (int) round( $seconds / 60 ) );
		}
		return sprintf( '%d s', $seconds );
	}

	/**
	 * Seed made-up journeys: a weighted walk over the site's own pages, a shop's when it has published products.
	 *
	 * @since 0.31.0
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args `count`, `months`.
	 * @return void
	 */
	public function seed( array $args, array $assoc_args ): void {
		global $wpdb;
		unset( $args );
		if ( 'production' === wp_get_environment_type() ) {
			WP_CLI::error( 'Refusing to seed made-up journeys on a production site.' );
		}
		$count = (int) ( $assoc_args['count'] ?? self::DEFAULT_COUNT );
		if ( $count < 1 || $count > self::MAX_COUNT ) {
			WP_CLI::error( sprintf( '--count must be between 1 and %d.', self::MAX_COUNT ) );
		}
		$retention = WPS::instance()->config()->journeys_retention_months();
		$months    = (int) ( $assoc_args['months'] ?? $retention );
		if ( $months < 1 || $months > $retention ) {
			WP_CLI::error( sprintf( '--months must be between 1 and the retention, %d; older journeys are pruned daily.', $retention ) );
		}
		if ( ! WPS::journeys()->enabled() ) {
			WP_CLI::warning( 'History is off, so the daily prune will delete these rows. Switch it on in the Journeys tab to keep them.' );
		}

		$catalogue = $this->catalogue();
		$walk      = $catalogue['shop'] ? self::shop_walk() : self::blog_walk();
		mt_srand( 42 );
		$days  = self::day_weights( $months );
		$hours = array_combine( range( 0, 23 ), array( 1, 0.6, 0.4, 0.3, 0.3, 0.5, 1, 2, 3, 3.5, 3.5, 3.5, 4, 3.5, 3.2, 3, 3, 3.5, 4, 4.5, 5, 4.5, 3.5, 2 ) );
		$made  = 0;
		for ( $i = 0; $i < $count; $i++ ) {
			$steps   = $this->walk( $walk, $catalogue );
			$total   = array_sum( array_map( static fn( string $step ): int => (int) explode( ':', $step )[2], $steps ) );
			$day     = (int) self::pick( $days );
			$hour    = (int) self::pick( $hours );
			$started = min( time() - 60, (int) strtotime( gmdate( 'Y-m-d', (int) strtotime( "-{$day} days" ) ) . sprintf( ' %02d:%02d:%02d', $hour, mt_rand( 0, 59 ), mt_rand( 0, 59 ) ) ) );
			$ended   = $started + intdiv( $total, 1000 );
			$made   += (int) Journeys::insert_row(
				array(
					'journey_id' => wp_generate_uuid4(),
					'visitor'    => self::SEED_PREFIX . substr( wp_generate_uuid4(), strlen( self::SEED_PREFIX ) ),
					'journey'    => implode( '>', $steps ),
					'steps'      => count( $steps ),
					'outcome'    => 'left',
					'started_at' => gmdate( 'Y-m-d H:i:s', $started ),
					'last_seen'  => gmdate( 'Y-m-d H:i:s', $ended ),
				)
			);
		}
		delete_transient( Journeys::VISUALS_TRANSIENT );
		WP_CLI::success( sprintf( 'Seeded %d journeys over %d month(s) (%s walk). Remove them with `wp wordsocket journeys unseed`.', $made, $months, $catalogue['shop'] ? 'shop' : 'blog' ) );
	}

	/**
	 * Delete every seeded journey.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function unseed(): void {
		global $wpdb;
		$deleted = (int) $wpdb->query( 'DELETE FROM ' . Journeys::table() . ' WHERE ' . self::seeded_where() );
		delete_transient( Journeys::VISUALS_TRANSIENT );
		WP_CLI::success( sprintf( 'Deleted %d seeded journeys.', $deleted ) );
	}

	/**
	 * The `WHERE` that picks seeded rows: visitor ids starting with SEED_PREFIX, as the bytes store them.
	 *
	 * @since 0.31.0
	 *
	 * @return string
	 */
	private static function seeded_where(): string {
		global $wpdb;
		return $wpdb->prepare( 'HEX(visitor) LIKE %s', $wpdb->esc_like( strtoupper( str_replace( '-', '', self::SEED_PREFIX ) ) ) . '%' );
	}

	/**
	 * Delete stored journeys, every one or those started between two days on the site's clock, after a confirmation.
	 *
	 * @since 0.31.0
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args `from`, `to`, `yes`.
	 * @return void
	 */
	public function purge( array $args, array $assoc_args ): void {
		unset( $args );
		$from = isset( $assoc_args['from'] ) ? (string) $assoc_args['from'] : null;
		$to   = isset( $assoc_args['to'] ) ? (string) $assoc_args['to'] : null;
		foreach ( array(
			'from' => $from,
			'to'   => $to,
		) as $name => $value ) {
			if ( null !== $value && ! Journeys::is_date( $value ) ) {
				WP_CLI::error( sprintf( '--%s must be a day as YYYY-MM-DD.', $name ) );
			}
		}
		if ( null !== $from && null !== $to && $from > $to ) {
			WP_CLI::error( '--from is after --to.' );
		}
		$journeys = WPS::journeys();
		$count    = $journeys->count( $from, $to );
		if ( 0 === $count ) {
			WP_CLI::success( 'No journeys to delete.' );
			return;
		}
		$range = null === $from && null === $to
			? 'every stored journey'
			: rtrim( 'the journeys started ' . ( null === $from ? '' : 'from ' . $from . ' ' ) . ( null === $to ? '' : 'to ' . $to ) );
		WP_CLI::confirm( sprintf( 'Delete %s (%d)? This cannot be undone.', $range, $count ), $assoc_args );
		WP_CLI::success( sprintf( 'Deleted %d journeys.', $journeys->purge( $from, $to ) ) );
	}

	/**
	 * The site's published ids to walk over, and whether it is a shop.
	 *
	 * @since 0.31.0
	 *
	 * @return array{posts: int[], pages: int[], products: int[], categories: int[], shop: bool}
	 */
	private function catalogue(): array {
		global $wpdb;
		$ids      = static fn( string $type ): array => array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_status = 'publish'", $type ) ) );
		$products = $ids( 'product' );
		return array(
			'posts'      => $ids( 'post' ),
			'pages'      => $ids( 'page' ),
			'products'   => $products,
			'categories' => array_map( 'intval', (array) $wpdb->get_col( "SELECT t.term_id FROM {$wpdb->terms} t JOIN {$wpdb->term_taxonomy} tt ON tt.term_id = t.term_id WHERE tt.taxonomy = 'product_cat' AND t.slug <> 'uncategorized'" ) ),
			'shop'       => ! empty( $products ),
		);
	}

	/**
	 * One journey's steps as `kind:id:s`, at most 14, with away steps returning to the page they left.
	 *
	 * @since 0.31.0
	 *
	 * @param array $walk      `{ start, next, dwell }`.
	 * @param array $catalogue What `catalogue()` found.
	 * @return string[]
	 */
	private function walk( array $walk, array $catalogue ): array {
		$kind  = self::pick( $walk['start'] );
		$id    = self::id_for( $kind, $catalogue );
		$steps = array();
		$from  = null;
		for ( $k = 0; $k < 14; $k++ ) {
			list( $low, $high ) = $walk['dwell'][ $kind ];
			$steps[]            = "{$kind}:{$id}:" . self::log_uniform( $low, $high );
			if ( self::rnd() < ( count( $steps ) < 2 ? 0.08 : 0.12 + 0.05 * ( count( $steps ) - 2 ) ) ) {
				break;
			}
			if ( 'away' === $kind ) {
				list( $kind, $id ) = $from;
				$from              = null;
				continue;
			}
			$to = self::pick( $walk['next'][ $kind ] );
			if ( 'away' === $to ) {
				$from = array( $kind, $id );
				$kind = 'away';
				$id   = 0;
				continue;
			}
			$id   = ( $to === $kind && self::rnd() < 0.3 ) ? $id : self::id_for( $to, $catalogue );
			$kind = $to;
		}
		return $steps;
	}

	/**
	 * A random published id for a page kind, 0 for a kind without one.
	 *
	 * @since 0.31.0
	 *
	 * @param string $kind      The page kind.
	 * @param array  $catalogue What `catalogue()` found.
	 * @return int
	 */
	private static function id_for( string $kind, array $catalogue ): int {
		$pool = array(
			'post'     => $catalogue['posts'],
			'page'     => $catalogue['pages'],
			'product'  => $catalogue['products'],
			'category' => $catalogue['categories'],
		)[ $kind ] ?? array();
		if ( empty( $pool ) ) {
			return 'category' === $kind ? 1 : 0;
		}
		return $pool[ (int) floor( self::rnd() * count( $pool ) ) ];
	}

	/**
	 * A blog's walk: where visits start, where each page leads, and how long each kind is read, in seconds.
	 *
	 * @since 0.31.0
	 *
	 * @return array{start: array<string, int>, next: array<string, array<string, int>>, dwell: array<string, int[]>}
	 */
	private static function blog_walk(): array {
		return array(
			'start' => array(
				'home'   => 40,
				'post'   => 40,
				'page'   => 10,
				'search' => 10,
			),
			'next'  => array(
				'home'         => array(
					'post'         => 45,
					'page'         => 20,
					'search'       => 10,
					'away'         => 15,
					'post_archive' => 10,
				),
				'post'         => array(
					'post'     => 40,
					'home'     => 15,
					'page'     => 10,
					'away'     => 20,
					'search'   => 5,
					'category' => 10,
				),
				'page'         => array(
					'home' => 30,
					'post' => 30,
					'away' => 20,
					'page' => 20,
				),
				'search'       => array(
					'post' => 60,
					'home' => 20,
					'away' => 20,
				),
				'post_archive' => array(
					'post' => 70,
					'home' => 15,
					'away' => 15,
				),
				'category'     => array(
					'post' => 70,
					'home' => 10,
					'away' => 20,
				),
			),
			'dwell' => self::dwell(),
		);
	}

	/**
	 * A shop's walk: where visits start, where each page leads, and how long each kind is looked at, in seconds.
	 *
	 * @since 0.31.0
	 *
	 * @return array{start: array<string, int>, next: array<string, array<string, int>>, dwell: array<string, int[]>}
	 */
	private static function shop_walk(): array {
		return array(
			'start' => array(
				'home'     => 40,
				'product'  => 28,
				'category' => 14,
				'shop'     => 10,
				'page'     => 8,
			),
			'next'  => array(
				'home'     => array(
					'category' => 35,
					'shop'     => 20,
					'product'  => 25,
					'page'     => 8,
					'away'     => 12,
				),
				'shop'     => array(
					'product'  => 50,
					'category' => 25,
					'shop'     => 10,
					'away'     => 10,
					'home'     => 5,
				),
				'category' => array(
					'product'  => 55,
					'category' => 15,
					'shop'     => 5,
					'away'     => 10,
					'home'     => 10,
					'page'     => 5,
				),
				'product'  => array(
					'product'  => 26,
					'cart'     => 30,
					'category' => 18,
					'away'     => 12,
					'home'     => 4,
					'page'     => 5,
					'shop'     => 5,
				),
				'page'     => array(
					'home'     => 30,
					'product'  => 30,
					'category' => 15,
					'away'     => 15,
					'cart'     => 10,
				),
				'cart'     => array(
					'checkout' => 52,
					'product'  => 20,
					'away'     => 16,
					'category' => 7,
					'cart'     => 5,
				),
				'checkout' => array(
					'away'    => 40,
					'cart'    => 25,
					'product' => 20,
					'page'    => 15,
				),
			),
			'dwell' => self::dwell(),
		);
	}

	/**
	 * How long each kind is on screen, as `[ low, high ]` in seconds.
	 *
	 * @since 0.31.0
	 *
	 * @return array<string, int[]>
	 */
	private static function dwell(): array {
		return array(
			'home'         => array( 2, 8 ),
			'post'         => array( 8, 180 ),
			'page'         => array( 4, 40 ),
			'search'       => array( 3, 12 ),
			'post_archive' => array( 3, 15 ),
			'category'     => array( 3, 15 ),
			'shop'         => array( 4, 15 ),
			'product'      => array( 6, 60 ),
			'cart'         => array( 4, 25 ),
			'checkout'     => array( 20, 90 ),
			'away'         => array( 8, 900 ),
		);
	}

	/**
	 * Weights for each day of the last `$months` months, by days ago: busier lately, quieter at weekends.
	 *
	 * @since 0.31.0
	 *
	 * @param int $months How many months back the days reach.
	 * @return array<int, float>
	 */
	private static function day_weights( int $months ): array {
		$span    = max( 1, (int) floor( ( time() - (int) strtotime( "-{$months} months" ) ) / DAY_IN_SECONDS ) );
		$weights = array();
		for ( $d = 0; $d < $span; $d++ ) {
			$weekend       = in_array( (int) gmdate( 'N', (int) strtotime( "-{$d} days" ) ), array( 6, 7 ), true );
			$weights[ $d ] = ( 1 + 0.5 * ( $span - 1 - $d ) / $span ) * ( $weekend ? 0.55 : 1 );
		}
		return $weights;
	}

	/**
	 * A key of a weight table, drawn in proportion to its weight.
	 *
	 * @since 0.31.0
	 *
	 * @param array<string|int, int|float> $weights Key to weight.
	 * @return string
	 */
	private static function pick( array $weights ): string {
		$r = self::rnd() * array_sum( $weights );
		foreach ( $weights as $key => $weight ) {
			$r -= $weight;
			if ( $r <= 0 ) {
				return (string) $key;
			}
		}
		return (string) array_key_last( $weights );
	}

	/**
	 * A time between two bounds, spread evenly on a log scale, in whole seconds.
	 *
	 * @since 0.31.0
	 *
	 * @param int $low  Least, in seconds.
	 * @param int $high Most, in seconds.
	 * @return int
	 */
	private static function log_uniform( int $low, int $high ): int {
		return max( 1, (int) round( exp( log( $low ) + self::rnd() * ( log( $high ) - log( $low ) ) ) ) );
	}

	/**
	 * A uniform number in [0, 1] from the seeded generator.
	 *
	 * @since 0.31.0
	 *
	 * @return float
	 */
	private static function rnd(): float {
		return mt_rand() / mt_getrandmax();
	}
}
