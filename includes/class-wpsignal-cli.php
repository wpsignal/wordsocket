<?php
/**
 * WPSignal\Cli: WordSocket's WP-CLI commands.
 *
 * - `wp wordsocket journeys seed [--count=<n>]` fills the journeys table with made-up visits for a look at the Journeys tab.
 * - `wp wordsocket journeys unseed` deletes them again.
 * - Seeded visitor ids start with `5eed0000-`, which no browser makes, so only seeded rows are ever removed.
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
 * Seeds and clears made-up journeys.
 *
 * @since 0.31.0
 */
class Cli {

	/**
	 * The visitor id prefix every seeded row carries.
	 *
	 * @since 0.31.0
	 */
	const SEED_PREFIX = '5eed0000-';

	/**
	 * Journeys seeded when `--count` is not given, and the most one call seeds.
	 *
	 * @since 0.31.0
	 */
	const DEFAULT_COUNT = 300;
	const MAX_COUNT     = 5000;

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
			'wordsocket journeys seed',
			array( $cli, 'seed' ),
			array(
				'shortdesc' => 'Fill the journeys table with made-up visits from the last 28 days, for a look at the Journeys tab.',
				'synopsis'  => array(
					array(
						'type'        => 'assoc',
						'name'        => 'count',
						'description' => 'How many journeys to seed.',
						'optional'    => true,
						'default'     => (string) self::DEFAULT_COUNT,
					),
				),
			)
		);
		WP_CLI::add_command(
			'wordsocket journeys unseed',
			array( $cli, 'unseed' ),
			array( 'shortdesc' => 'Delete the journeys the seed command made.' )
		);
	}

	/**
	 * Seed made-up journeys: a weighted walk over the site's own pages, a shop's when it has published products.
	 *
	 * @since 0.31.0
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args `count`.
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
		if ( ! WPS::journeys()->enabled() ) {
			WP_CLI::warning( 'History is off, so the daily prune will delete these rows. Switch it on in the Journeys tab to keep them.' );
		}

		$catalogue = $this->catalogue();
		$walk      = $catalogue['shop'] ? self::shop_walk() : self::blog_walk();
		mt_srand( 42 );
		$days  = self::day_weights();
		$hours = array_combine( range( 0, 23 ), array( 1, 0.6, 0.4, 0.3, 0.3, 0.5, 1, 2, 3, 3.5, 3.5, 3.5, 4, 3.5, 3.2, 3, 3, 3.5, 4, 4.5, 5, 4.5, 3.5, 2 ) );
		$table = Journeys::table();
		$made  = 0;
		for ( $i = 0; $i < $count; $i++ ) {
			$steps   = $this->walk( $walk, $catalogue );
			$total   = array_sum( array_map( static fn( string $step ): int => (int) explode( ':', $step )[2], $steps ) );
			$day     = (int) self::pick( $days );
			$hour    = (int) self::pick( $hours );
			$started = min( time() - 60, (int) strtotime( gmdate( 'Y-m-d', (int) strtotime( "-{$day} days" ) ) . sprintf( ' %02d:%02d:%02d', $hour, mt_rand( 0, 59 ), mt_rand( 0, 59 ) ) ) );
			$ended   = $started + intdiv( $total, 1000 );
			$made   += (int) $wpdb->insert(
				$table,
				array(
					'journey_id' => wp_generate_uuid4(),
					'visitor'    => self::SEED_PREFIX . substr( wp_generate_uuid4(), strlen( self::SEED_PREFIX ) ),
					'journey'    => implode( '>', $steps ),
					'steps'      => count( $steps ),
					'outcome'    => 'left',
					'started_at' => gmdate( 'Y-m-d H:i:s', $started ),
					'last_seen'  => gmdate( 'Y-m-d H:i:s', $ended ),
					'ended_at'   => gmdate( 'Y-m-d H:i:s', $ended ),
				)
			);
		}
		delete_transient( Journeys::VISUALS_TRANSIENT );
		WP_CLI::success( sprintf( 'Seeded %d journeys (%s walk). Remove them with `wp wordsocket journeys unseed`.', $made, $catalogue['shop'] ? 'shop' : 'blog' ) );
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
		$deleted = (int) $wpdb->query(
			$wpdb->prepare( 'DELETE FROM ' . Journeys::table() . ' WHERE visitor LIKE %s', $wpdb->esc_like( self::SEED_PREFIX ) . '%' )
		);
		delete_transient( Journeys::VISUALS_TRANSIENT );
		WP_CLI::success( sprintf( 'Deleted %d seeded journeys.', $deleted ) );
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
	 * One journey's steps as `kind:id:ms`, at most 14, with away steps returning to the page they left.
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
	 * A blog's walk: where visits start, where each page leads, and how long each kind is read, in ms.
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
	 * A shop's walk: where visits start, where each page leads, and how long each kind is looked at, in ms.
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
	 * How long each kind is on screen, as `[ low, high ]` in ms.
	 *
	 * @since 0.31.0
	 *
	 * @return array<string, int[]>
	 */
	private static function dwell(): array {
		return array(
			'home'         => array( 1500, 8000 ),
			'post'         => array( 8000, 180000 ),
			'page'         => array( 4000, 40000 ),
			'search'       => array( 3000, 12000 ),
			'post_archive' => array( 3000, 15000 ),
			'category'     => array( 3000, 15000 ),
			'shop'         => array( 4000, 15000 ),
			'product'      => array( 6000, 60000 ),
			'cart'         => array( 4000, 25000 ),
			'checkout'     => array( 20000, 90000 ),
			'away'         => array( 8000, 900000 ),
		);
	}

	/**
	 * Weights for the last 28 days: busier lately, quieter at weekends.
	 *
	 * @since 0.31.0
	 *
	 * @return array<int, float>
	 */
	private static function day_weights(): array {
		$weights = array();
		for ( $d = 0; $d < 28; $d++ ) {
			$weekend       = in_array( (int) gmdate( 'N', (int) strtotime( "-{$d} days" ) ), array( 6, 7 ), true );
			$weights[ $d ] = ( 1 + 0.02 * ( 27 - $d ) ) * ( $weekend ? 0.55 : 1 );
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
	 * A time between two bounds, spread evenly on a log scale and rounded to 100 ms.
	 *
	 * @since 0.31.0
	 *
	 * @param int $low  Least, in ms.
	 * @param int $high Most, in ms.
	 * @return int
	 */
	private static function log_uniform( int $low, int $high ): int {
		return (int) ( round( exp( log( $low ) + self::rnd() * ( log( $high ) - log( $low ) ) ) / 100 ) * 100 );
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
