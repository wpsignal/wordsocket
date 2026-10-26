<?php
/**
 * Seed journeys into WordSocket's history table for a look at the Journeys tab.
 *
 * - A weighted walk over home, posts, pages, search, the blog index, a category and away, 28 days back,
 *   weekday and hour weighted, deterministic; on a site with published products the walk is a shop's
 *   instead (home, shop, category, product, cart, checkout, away).
 * - Every visitor id starts with "5eed0000-", so one DELETE removes them again:
 *   DELETE FROM {prefix}wpsignal_journeys WHERE visitor LIKE '5eed0000-%'.
 * - Usage: wp --path=<site> eval-file bin/seed-journeys.php [count]   (300 by default). Not shipped.
 *
 * @package WordSocket
 */

// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, WordPress.WP.AlternativeFunctions.rand_mt_rand, WordPress.WP.AlternativeFunctions.rand_seeding_mt_srand

global $wpdb;
$count = isset( $args[0] ) ? max( 1, (int) $args[0] ) : 300;
mt_srand( 42 );
$table = \WPSignal\Journeys::table();
$posts    = array_map( 'intval', $wpdb->get_col( "SELECT ID FROM {$wpdb->posts} WHERE post_type = 'post' AND post_status = 'publish'" ) );
$pages    = array_map( 'intval', $wpdb->get_col( "SELECT ID FROM {$wpdb->posts} WHERE post_type = 'page' AND post_status = 'publish'" ) );
$products = array_map( 'intval', $wpdb->get_col( "SELECT ID FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status = 'publish'" ) );
$cats     = array_map( 'intval', $wpdb->get_col( "SELECT t.term_id FROM {$wpdb->terms} t JOIN {$wpdb->term_taxonomy} tt ON tt.term_id = t.term_id WHERE tt.taxonomy = 'product_cat' AND t.slug <> 'uncategorized'" ) );
$shop     = ! empty( $products );
$rnd   = static fn(): float => mt_rand() / mt_getrandmax();
$pick  = static function ( array $table ) use ( $rnd ): string {
	$total = array_sum( $table );
	$r     = $rnd() * $total;
	foreach ( $table as $k => $w ) {
		$r -= $w;
		if ( $r <= 0 ) {
			return (string) $k;
		}
	}
	return (string) array_key_last( $table );
};
$next  = $shop ? array(
	'home'     => array( 'category' => 35, 'shop' => 20, 'product' => 25, 'page' => 8, 'away' => 12 ),
	'shop'     => array( 'product' => 50, 'category' => 25, 'shop' => 10, 'away' => 10, 'home' => 5 ),
	'category' => array( 'product' => 55, 'category' => 15, 'shop' => 5, 'away' => 10, 'home' => 10, 'page' => 5 ),
	'product'  => array( 'product' => 26, 'cart' => 30, 'category' => 18, 'away' => 12, 'home' => 4, 'page' => 5, 'shop' => 5 ),
	'page'     => array( 'home' => 30, 'product' => 30, 'category' => 15, 'away' => 15, 'cart' => 10 ),
	'cart'     => array( 'checkout' => 52, 'product' => 20, 'away' => 16, 'category' => 7, 'cart' => 5 ),
	'checkout' => array( 'away' => 40, 'cart' => 25, 'product' => 20, 'page' => 15 ),
) : array(
	'home'   => array( 'post' => 45, 'page' => 20, 'search' => 10, 'away' => 15, 'post_archive' => 10 ),
	'post'   => array( 'post' => 40, 'home' => 15, 'page' => 10, 'away' => 20, 'search' => 5, 'category' => 10 ),
	'page'   => array( 'home' => 30, 'post' => 30, 'away' => 20, 'page' => 20 ),
	'search' => array( 'post' => 60, 'home' => 20, 'away' => 20 ),
	'post_archive' => array( 'post' => 70, 'home' => 15, 'away' => 15 ),
	'category' => array( 'post' => 70, 'home' => 10, 'away' => 20 ),
);
$dwell = array( 'home' => array( 1500, 8000 ), 'post' => array( 8000, 180000 ), 'page' => array( 4000, 40000 ), 'search' => array( 3000, 12000 ), 'post_archive' => array( 3000, 15000 ), 'category' => array( 3000, 15000 ), 'shop' => array( 4000, 15000 ), 'product' => array( 6000, 60000 ), 'cart' => array( 4000, 25000 ), 'checkout' => array( 20000, 90000 ), 'away' => array( 8000, 900000 ) );
$log   = static fn( int $lo, int $hi ): int => (int) ( round( exp( log( $lo ) + $rnd() * ( log( $hi ) - log( $lo ) ) ) / 100 ) * 100 );
$id    = static function ( string $kind ) use ( $posts, $pages, $products, $cats, $rnd ): int {
	if ( 'post' === $kind ) return $posts[ (int) floor( $rnd() * count( $posts ) ) ] ?? 0;
	if ( 'page' === $kind ) return $pages[ (int) floor( $rnd() * count( $pages ) ) ] ?? 0;
	if ( 'product' === $kind ) return $products[ (int) floor( $rnd() * count( $products ) ) ] ?? 0;
	if ( 'category' === $kind ) return $cats[ (int) floor( $rnd() * count( $cats ) ) ] ?? 1;
	return 0;
};
$day_w  = array();
for ( $d = 0; $d < 28; $d++ ) $day_w[ $d ] = ( 1 + 0.02 * ( 27 - $d ) ) * ( in_array( (int) gmdate( 'N', strtotime( "-{$d} days" ) ), array( 6, 7 ), true ) ? 0.55 : 1 );
$hour_w = array( 1, 0.6, 0.4, 0.3, 0.3, 0.5, 1, 2, 3, 3.5, 3.5, 3.5, 4, 3.5, 3.2, 3, 3, 3.5, 4, 4.5, 5, 4.5, 3.5, 2 );
$n = 0;
for ( $i = 0; $i < $count; $i++ ) {
	$kind = $pick( $shop ? array( 'home' => 40, 'product' => 28, 'category' => 14, 'shop' => 10, 'page' => 8 ) : array( 'home' => 40, 'post' => 40, 'page' => 10, 'search' => 10 ) );
	$step_id = $id( $kind ); $steps = array(); $from = null;
	for ( $k = 0; $k < 14; $k++ ) {
		$steps[] = "{$kind}:{$step_id}:" . $log( $dwell[ $kind ][0], $dwell[ $kind ][1] );
		if ( $rnd() < ( count( $steps ) < 2 ? 0.08 : 0.12 + 0.05 * ( count( $steps ) - 2 ) ) ) break;
		if ( 'away' === $kind ) { [ $kind, $step_id ] = $from; $from = null; continue; }
		$to = $pick( $next[ $kind ] );
		if ( 'away' === $to ) { $from = array( $kind, $step_id ); $kind = 'away'; $step_id = 0; continue; }
		$step_id = ( $to === $kind && $rnd() < 0.3 ) ? $step_id : $id( $to ); $kind = $to;
	}
	$journey = implode( '>', $steps );
	$total   = array_sum( array_map( static fn( $s ) => (int) explode( ':', $s )[2], $steps ) );
	$d = (int) $pick( $day_w ); $h = (int) $pick( array_combine( range( 0, 23 ), $hour_w ) );
	$started = min( time() - 60, strtotime( gmdate( 'Y-m-d', strtotime( "-{$d} days" ) ) . sprintf( ' %02d:%02d:%02d', $h, mt_rand( 0, 59 ), mt_rand( 0, 59 ) ) ) );
	$ended   = $started + (int) ( $total / 1000 );
	$visitor = '5eed0000-' . substr( wp_generate_uuid4(), 9 );
	$wpdb->insert( $table, array( 'journey_id' => wp_generate_uuid4(), 'visitor' => $visitor, 'journey' => $journey, 'steps' => count( $steps ), 'outcome' => 'left', 'started_at' => gmdate( 'Y-m-d H:i:s', $started ), 'last_seen' => gmdate( 'Y-m-d H:i:s', $ended ), 'ended_at' => gmdate( 'Y-m-d H:i:s', $ended ) ) );
	$n++;
}
echo "seeded {$n} journeys\n";
