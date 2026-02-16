<?php
/**
 * WPSignal admin — backward-compatibility wrapper.
 *
 * All admin functionality has moved to WPSignal_Admin.
 * This file is kept so that any code doing `require_once 'includes/admin.php'`
 * continues to work without error.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
