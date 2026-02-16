<?php
/**
 * Plugin Name: WPSignal
 * Plugin URI:  https://wpsignal.io
 * Description: Realtime push events from WordPress to browsers via wpsignal.io (WebSocket/SSE).
 * Version:     0.2.0
 * Author:      WPSignal
 * License:     GPL-2.0-or-later
 * Text Domain: wpsignal
 *
 * @package WPSignal
 *
 * This is the main bootstrap file for the WPSignal plugin. It defines global
 * constants, loads the class autoloader and backward-compatibility wrappers,
 * then boots the plugin via the WPSignal singleton facade.
 *
 * Boot sequence:
 *   1. Define constants (WPSIGNAL_VERSION, WPSIGNAL_FILE, WPSIGNAL_DIR, WPSIGNAL_URL)
 *   2. Load autoloader (includes/autoload.php)
 *   3. Load backward-compat function wrappers (publish.php, rest.php, admin.php)
 *   4. WPSignal::instance()->boot() — instantiates and wires all components
 *
 * @see WPSignal::boot() for the full initialization sequence.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** @var string Current plugin version. */
define( 'WPSIGNAL_VERSION', '0.2.0' );

/** @var string Absolute path to this plugin file. */
define( 'WPSIGNAL_FILE', __FILE__ );

/** @var string Absolute path to the plugin directory (with trailing slash). */
define( 'WPSIGNAL_DIR', plugin_dir_path( __FILE__ ) );

/** @var string URL to the plugin directory (with trailing slash). */
define( 'WPSIGNAL_URL', plugin_dir_url( __FILE__ ) );

// Autoloader for WPSignal_* classes.
require_once WPSIGNAL_DIR . 'includes/autoload.php';

// Backward-compatibility function wrappers.
require_once WPSIGNAL_DIR . 'includes/publish.php';
require_once WPSIGNAL_DIR . 'includes/rest.php';
require_once WPSIGNAL_DIR . 'includes/admin.php';

// Boot the plugin.
WPSignal::instance()->boot();
