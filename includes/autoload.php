<?php
/**
 * WPSignal namespace autoloader.
 *
 * Registers an SPL autoloader that maps WPSignal\ namespace classes to file
 * paths using the WordPress naming convention:
 *
 *   Class                       → File
 *   WPSignal\WPS                → class-wps.php
 *   WPSignal\Config             → class-wpsignal-config.php
 *   WPSignal\Trigger_Registry   → class-wpsignal-trigger-registry.php
 *
 * All class files live in the `includes/` directory. Only classes in the
 * WPSignal namespace are handled: all others are ignored so this autoloader
 * can coexist with Composer or other autoloaders.
 *
 * @package WPSignal
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

spl_autoload_register( function ( $class ) {
	// Only handle classes in the WPSignal namespace.
	if ( strpos( $class, 'WPSignal\\' ) !== 0 ) {
		return;
	}

	// Strip the namespace prefix to get the short class name.
	$short = substr( $class, strlen( 'WPSignal\\' ) );

	// Special case: WPS facade maps to class-wps.php.
	if ( $short === 'WPS' ) {
		$file = 'class-wps.php';
	} else {
		// Convert underscores to hyphens, lowercase, prefix with class-wpsignal-.
		$file = 'class-wpsignal-' . strtolower( str_replace( '_', '-', $short ) ) . '.php';
	}

	$path = \WPSignal\DIR . 'includes/' . $file;

	if ( file_exists( $path ) ) {
		require_once $path;
	}
} );
