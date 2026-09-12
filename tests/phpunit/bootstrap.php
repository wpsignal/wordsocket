<?php
/**
 * PHPUnit bootstrap: load the local WordPress install with this plugin active.
 *
 * The suite runs against a real (local) WordPress rather than the core test
 * library, so it exercises the same hooks, REST server, and options the
 * plugin sees in production. Tests snapshot and restore every option they
 * touch (see WordSocketTestCase), and outbound HTTP is intercepted with the
 * `pre_http_request` filter, so the WPSignal server is never contacted.
 *
 * Refuses to run unless the target WordPress declares a local or development
 * environment, so it can never be pointed at a live site by accident.
 */

$wp_root = getenv( 'WP_ROOT' );
if ( ! $wp_root || ! file_exists( $wp_root . '/wp-load.php' ) ) {
	fwrite( STDERR, "WP_ROOT must point at a WordPress install (wp-load.php not found at '{$wp_root}').\n" );
	exit( 1 );
}

// wp-load.php expects to be reached over HTTP for some paths; give it a host.
$_SERVER['HTTP_HOST']      = $_SERVER['HTTP_HOST'] ?? 'localhost';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI']    = '/';

require_once $wp_root . '/wp-load.php';

if ( ! in_array( wp_get_environment_type(), array( 'local', 'development' ), true ) ) {
	fwrite( STDERR, "Refusing to run: WP_ENVIRONMENT_TYPE is '" . wp_get_environment_type() . "', expected local or development.\n" );
	exit( 1 );
}

if ( ! class_exists( 'WPSignal\\WPS' ) ) {
	fwrite( STDERR, "WordSocket is not active on the target site.\n" );
	exit( 1 );
}

require_once __DIR__ . '/WordSocketTestCase.php';
