<?php
/**
 * WPSignal\REST - backward-compatibility wrappers.
 *
 * These functions were part of the original procedural plugin. They are kept
 * for backward compatibility with any code that calls them directly.
 * New code should use the class-based API instead.
 *
 * @package WordSocket
 * @see Config::jwt_secret()
 * @see Token::base64url_encode()
 */

 namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Get the JWT secret.
 *
 * Priority: wp_options (auto-saved during registration) > WPSIGNAL_JWT_SECRET
 * constant in wp-config.php.
 *
 * Prefer using the config accessor in new code:
 *
 *     $secret = WPS::instance()->config()->jwt_secret();
 *
 * @return string JWT secret or empty string if not configured.
 */
function wpsignal_get_jwt_secret() {
	return WPS::instance()->config()->jwt_secret();
}

/**
 * Base64url encoding (RFC 7515).
 *
 * Prefer using the static method in new code:
 *
 *     $encoded = Token::base64url_encode( $data );
 *
 * @param string $data Raw data to encode.
 * @return string Base64url-encoded string.
 */
function wpsignal_base64url_encode( $data ) {
	return Token::base64url_encode( $data );
}
