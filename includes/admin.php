<?php
/**
 * WordSocket admin: backward-compatibility wrapper.
 *
 * All admin functionality has moved to Admin_Page.
 * This file is kept so that any code doing `require_once 'includes/admin.php'`
 * continues to work without error.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
