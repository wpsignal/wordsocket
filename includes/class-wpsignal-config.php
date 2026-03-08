<?php
/**
 * WPSignal\Config: centralizes all wp_options access.
 *
 * Provides typed accessors for every WordSocket option stored in the WordPress
 * database. This keeps option key strings in one place and makes it easy to
 * mock configuration in tests.
 *
 * Options managed:
 *   - wpsignal_base_url   : WPSignal server URL (e.g. "https://api.wpsignal.io")
 *   - wpsignal_site_key   : Site identifier (16 random bytes, hex)
 *   - wpsignal_site_secret: HMAC publish secret (32 random bytes, hex)
 *   - wpsignal_api_key    : Dashboard API key for site registration
 *   - wpsignal_jwt_secret : Shared secret for minting connection JWTs
 *
 * Usage:
 *
 *     $config = WPSignal::instance()->config();
 *
 *     if ( $config->is_configured() ) {
 *         $url = $config->base_url();
 *         $key = $config->site_key();
 *     }
 *
 * @package WordSocket
 */

 namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Config {

	/**
	 * Get the WPSignal server base URL.
	 *
	 * @return string Server URL or empty string if not set.
	 */
	public function base_url() {
		return defined( '\\WPSignal\\BASE_URL' ) ? BASE_URL : 'https://api.wpsignal.io';
	}

	/**
	 * Define in wp-config.php to point the plugin at a self-hosted WPSignal server.
	 *
	 * When defined, overrides the default `https://api.wpsignal.io` endpoint for
	 * all publish, registration, and token requests.
	 *
	 * @const WPSignal\BASE_URL
	 * @usage: self-hosted server:
	 * ```php
	 *     define( 'WPSignal\BASE_URL', 'https://signal.example.com' );
	 * ```
	 */

	/**
	 * Get the site key (public site identifier).
	 *
	 * Assigned by the server during site registration. Used in publish headers
	 * and to derive tenant_id / site_id for JWTs.
	 *
	 * @return string Site key (hex string) or empty string if not registered.
	 */
	public function site_key() {
		if ( defined( 'WPSIGNAL_SITE_KEY' ) ) {
			return WPSIGNAL_SITE_KEY;
		}
		return get_option( 'wpsignal_site_key', '' );
	}

	/**
	 * Get the publish secret (private HMAC signing key).
	 *
	 * Used to sign publish requests. Never exposed to browsers.
	 *
	 * @return string Publish secret (hex string) or empty string if not registered.
	 */
	public function site_secret() {
		if ( defined( 'WPSIGNAL_SITE_SECRET' ) ) {
			return WPSIGNAL_SITE_SECRET;
		}
		return get_option( 'wpsignal_site_secret', '' );
	}

	/**
	 * Get the dashboard API key.
	 *
	 * Used in the Authorization header when registering sites with the server.
	 *
	 * @return string API key or empty string if not set.
	 */
	public function api_key() {
		return get_option( 'wpsignal_api_key', '' );
	}

	/**
	 * Get the JWT signing secret.
	 *
	 * Priority: wp_options (auto-saved during registration) > WPSIGNAL_JWT_SECRET
	 * constant in wp-config.php (backward compatibility).
	 *
	 * @return string JWT secret or empty string if not configured.
	 */
	public function jwt_secret() {
		$stored = get_option( 'wpsignal_jwt_secret', '' );
		if ( ! empty( $stored ) ) {
			return $stored;
		}
		if ( defined( 'WPSIGNAL_JWT_SECRET' ) ) {
			return WPSIGNAL_JWT_SECRET;
		}
		return '';
	}

	/**
	 * Legacy override: define in wp-config.php to supply the JWT signing secret.
	 *
	 * Superseded by the secret returned during site registration (stored in
	 * wp_options as `wpsignal_jwt_secret`). Only needed for sites that were
	 * configured before the auto-registration flow existed.
	 *
	 * @const WPSIGNAL_JWT_SECRET
	 * @usage: legacy JWT secret:
	 * ```php
	 *     define( 'WPSIGNAL_JWT_SECRET', 'your-64-char-hex-secret' );
	 * ```
	 */

	/**
	 * Derive the AES-256-GCM encryption key from WordPress salts and the site key.
	 *
	 * Uses HKDF-SHA256 to produce a 32-byte key. The seed defaults to
	 * AUTH_KEY . SECURE_AUTH_KEY and is filterable via `wpsignal_encryption_seed`
	 * so plugin or theme developers can supply custom key material without
	 * modifying core. The site key is used as the HKDF salt to scope the
	 * derived key to this specific site registration.
	 *
	 * @usage: supply a custom seed:
	 * ```php
	 *     add_filter( 'wpsignal_encryption_seed', function ( $default ) {
	 *         return 'my-application-specific-secret';
	 *     } );
	 * ```
	 * @return string Raw 32-byte key, or empty string if site key is missing
	 *                or WP salt constants are not defined.
	 */
	public function encryption_key() {
		$site_key = $this->site_key();
		if ( empty( $site_key ) ) {
			return '';
		}
		if ( ! defined( 'AUTH_KEY' ) || ! defined( 'SECURE_AUTH_KEY' ) ) {
			return '';
		}
		/**
		 * Filters the seed used to derive the AES-256-GCM encryption key.
		 *
		 * The default seed is `AUTH_KEY . SECURE_AUTH_KEY`. Override this to
		 * supply your own key material without modifying WordPress salts.
		 *
		 * @param string $seed The default seed string.
		 * @usage: custom encryption seed:
		 * ```php
		 *     add_filter( 'wpsignal_encryption_seed', function ( $seed ) {
		 *         return 'my-application-specific-secret';
		 *     } );
		 * ```
		 */
		$seed = apply_filters( 'wpsignal_encryption_seed', AUTH_KEY . SECURE_AUTH_KEY );
		return hash_hkdf( 'sha256', $seed, 32, 'wpsignal-v1', $site_key );
	}

	/**
	 * Whether the WordSocket Yjs sync provider should be registered with the
	 * block editor. When false, the yjs-provider script is not enqueued and
	 * WordPress falls back to its default HTTP polling transport.
	 *
	 * Defaults to true so the provider is active after connecting.
	 *
	 * @return bool
	 */
	public function yjs_provider_enabled() {
		return get_option( 'wpsignal_yjs_provider_enabled', '1' ) !== '0';
	}

	/**
	 * Check whether the WordPress version is compatible with the WordSocket Yjs sync provider.
	 *
	 * @return bool True if the WordPress version is compatible, false otherwise.
	 */
	public function is_wp_sync_available() {
		return is_wp_version_compatible( '7.0' );
	}

	/**
	 * Check whether the plugin is fully configured for publishing.
	 *
	 * Returns true when base_url, site_key, and site_secret are all set.
	 *
	 * @return bool
	 */
	public function is_configured() {
		return ! empty( $this->base_url() )
			&& ! empty( $this->site_key() )
			&& ! empty( $this->site_secret() );
	}

	/**
	 * Save server registration credentials to wp_options.
	 *
	 * Called after a successful POST to /api/sites/register. Expects the
	 * response array from the server.
	 *
	 * @param array $data {
	 *     Registration response from the WPSignal server.
	 *
	 *     @type string $site_key       The assigned site key.
	 *     @type string $publish_secret The HMAC publish secret.
	 *     @type string $jwt_secret     The shared JWT signing secret.
	 * }
	 * @return void
	 */
	public function save_registration( $data ) {
		update_option( 'wpsignal_api_key', $data['api_key'] );
		update_option( 'wpsignal_site_key', $data['site_key'] );
		update_option( 'wpsignal_site_secret', $data['publish_secret'] );
		update_option( 'wpsignal_jwt_secret', $data['jwt_secret'] );
	}

	/**
	 * Save site credentials returned by the automatic connect flow.
	 *
	 * Unlike save_registration(), this does not touch the api_key option
	 * because the automatic flow authenticates via session JWT rather than
	 * an API key that the user pastes.
	 *
	 * @param array $data {
	 *     @type string $site_key       The assigned site key.
	 *     @type string $publish_secret The HMAC publish secret.
	 *     @type string $jwt_secret     The shared JWT signing secret.
	 * }
	 * @return void
	 */
	public function save_connection( $data ) {
		update_option( 'wpsignal_site_key', $data['site_key'] );
		update_option( 'wpsignal_site_secret', $data['publish_secret'] );
		update_option( 'wpsignal_jwt_secret', $data['jwt_secret'] );
	}

	/**
	 * Determine where site credentials come from.
	 *
	 * Returns 'constant' when all three credential constants are defined in
	 * wp-config.php, 'database' otherwise. Used by the settings UI to show a
	 * read-only notice when credentials are injected via constants.
	 *
	 * @return string 'constant' | 'database'
	 */
	public function credential_source() {
		if ( defined( 'WPSIGNAL_SITE_KEY' ) && defined( 'WPSIGNAL_SITE_SECRET' ) && defined( 'WPSIGNAL_JWT_SECRET' ) ) {
			return 'constant';
		}
		return 'database';
	}
}