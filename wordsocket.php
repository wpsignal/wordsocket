<?php
/**
 * Plugin Name:       WordSocket
 * Plugin URI:        https://wpsignal.io/wordsocket
 * Description:       WordSocket is the official WordPress plugin for WPSignal (wpsignal.io).
 * Version:           0.7.0
 * Author:            WPSignal
 * Author URI:        https://wpsignal.io
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wordsocket
 * Domain Path:       /languages
 * Requires at least: 6.2
 * Tested up to:      7.0
 * Requires PHP:      7.4
 *
 * @package WordSocket
 *
 * This is the main bootstrap file for the WordSocket plugin. It defines global
 * constants, loads the class autoloader and backward-compatibility wrappers,
 * then boots the plugin via the WPSignal singleton facade.
 *
 * Boot sequence:
 *   1. Define constants (WPSignal\VERSION, WPSignal\DIR, WPSignal\URL)
 *   2. Load autoloader (includes/autoload.php)
 *   3. Load backward-compat function wrappers (publish.php, rest.php, admin.php)
 *   4. WPS::instance()->boot(): instantiates and wires all components
 *
 * @see WPS::boot() for the full initialization sequence.
 */

 namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** @var string Current plugin version. */
const VERSION = '0.9.0';

/** @var string Absolute path to the plugin directory (with trailing slash). */
const DIR = __DIR__ . '/';

/** @var string URL to the plugin directory (with trailing slash). */
define( 'WPSignal\URL', plugin_dir_url( __FILE__ ) );

// Autoloader for WPSignal\ namespace classes.
require_once DIR . 'includes/autoload.php';

// Backward-compatibility function wrappers.
require_once DIR . 'includes/publish.php';
require_once DIR . 'includes/rest.php';
require_once DIR . 'includes/admin.php';

// Boot the plugin.
WPS::instance()->boot();
