<?php
/**
 * WordSocket uninstall handler.
 *
 * Fired when the plugin is deleted via the WordPress admin.
 * Removes all plugin options from the database.
 *
 * @package WordSocket
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'wpsignal_base_url' );
delete_option( 'wpsignal_api_key' );
delete_option( 'wpsignal_site_key' );
delete_option( 'wpsignal_site_secret' );
delete_option( 'wpsignal_jwt_secret' );
delete_option( 'wpsignal_custom_triggers' );
