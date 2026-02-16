<?php
/**
 * WPSignal class autoloader.
 *
 * Registers an SPL autoloader that maps WPSignal class names to file paths
 * using the WordPress naming convention:
 *
 *   ClassName          → File
 *   WPSignal           → class-wpsignal.php
 *   WPSignal_Config    → class-wpsignal-config.php
 *   WPSignal_Trigger_Registry → class-wpsignal-trigger-registry.php
 *
 * All class files live in the `includes/` directory. Only classes whose name
 * starts with "WPSignal" are handled — all others are ignored so this
 * autoloader can coexist with Composer or other autoloaders.
 *
 * @package WPSignal
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

spl_autoload_register( function ( $class ) {
	// Only handle classes starting with WPSignal.
	if ( strpos( $class, 'WPSignal' ) !== 0 ) {
		return;
	}

	$file = 'class-' . strtolower( str_replace( '_', '-', $class ) ) . '.php';
	$path = WPSIGNAL_DIR . 'includes/' . $file;

	if ( file_exists( $path ) ) {
		require_once $path;
	}
} );
