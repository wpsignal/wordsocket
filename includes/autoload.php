<?php
/**
 * WPSignal namespace autoloader.
 *
 * All class files live in the `includes/` directory. Only classes in the
 * WPSignal namespace are handled: all others are ignored so this autoloader
 * can coexist with Composer or other autoloaders.
 *
 * @package WordSocket
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

spl_autoload_register(
	function ( string $namespace_name ) {
		// Only handle classes in the WPSignal namespace.
		if ( strpos( $namespace_name, 'WPSignal\\' ) !== 0 ) {
				return;
		}

		// Strip the namespace prefix to get the short class name.
		$class_name = substr( $namespace_name, strlen( 'WPSignal\\' ) );
		$file       = 'class-wpsignal-' . strtolower( str_replace( '_', '-', $class_name ) ) . '.php';

		// Special case: WPS facade maps to class-wps.php.
		if ( 'WPS' === $class_name ) {
			$file = 'class-wps.php';
		}

		$path = \WPSignal\DIR . 'includes/' . $file;

		if ( file_exists( $path ) ) {
				require_once $path;
		}
	}
);
