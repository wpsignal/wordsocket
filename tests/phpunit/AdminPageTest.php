<?php
/**
 * Admin_Page: the settings page's inline config.
 *
 * @package WPSignal
 */

use WPSignal\Admin_Page;
use WPSignal\WPS;

/**
 * The config `wpsignalSettings` the settings app reads, as the page prints it.
 */
final class AdminPageTest extends WordSocketTestCase {

	/**
	 * The config the settings app reads, as the page prints it.
	 *
	 * @return array<string, mixed>
	 */
	private function settings_config(): array {
		$this->as_admin();
		ob_start();
		( new Admin_Page( WPS::instance()->config() ) )->render_settings_page();
		ob_end_clean();
		$inline = implode( "\n", (array) wp_scripts()->get_data( 'wpsignal-settings', 'before' ) );
		// One JSON object per line; the same handle also carries `wpSignalConfig` on another line.
		$this->assertSame( 1, preg_match( '/^window\.wpsignalSettings = (\{.*\});$/m', $inline, $m ), 'the settings config is printed before the bundle' );
		$config = json_decode( $m[1], true );
		$this->assertIsArray( $config );
		return $config;
	}

	public function test_the_notices_a_user_closed_are_printed_and_saved_through_their_user_meta(): void {
		$this->as_admin();
		$user = get_current_user_id();
		delete_user_meta( $user, Admin_Page::DISMISSED_META );
		$this->assertSame( array(), Admin_Page::dismissed_notices(), 'nothing closed yet' );

		$request = new WP_REST_Request( 'POST', '/wp/v2/users/me' );
		$request->set_body_params( array( 'meta' => array( Admin_Page::DISMISSED_META => array( 'object-cache-missing', 'object-cache-missing' ) ) ) );
		$response = rest_do_request( $request );
		$this->assertSame( 200, $response->get_status() );
		// The test site's cache drop-in serves the row read before the write; read the fresh one.
		wp_cache_delete( $user, 'user_meta' );
		$this->assertSame( array( 'object-cache-missing' ), get_user_meta( $user, Admin_Page::DISMISSED_META, true ), 'deduped' );
		$config = $this->settings_config();
		$this->assertSame( array( 'object-cache-missing' ), $config['dismissed'] );
		$this->assertIsBool( $config['history']['persistentCache'], 'the page prints the probe rather than asking a route' );

		$request = new WP_REST_Request( 'POST', '/wp/v2/users/me' );
		$request->set_body_params( array( 'meta' => array( Admin_Page::DISMISSED_META => array( 'Not A Slug' ) ) ) );
		$this->assertSame( 400, rest_do_request( $request )->get_status(), 'the schema refuses anything but a slug' );

		wp_set_current_user( 0 );
		$request = new WP_REST_Request( 'POST', '/wp/v2/users/' . $user );
		$request->set_body_params( array( 'meta' => array( Admin_Page::DISMISSED_META => array() ) ) );
		$this->assertSame( 401, rest_do_request( $request )->get_status(), 'nobody writes another user\'s list' );
		delete_user_meta( $user, Admin_Page::DISMISSED_META );
	}

	/**
	 * 0.29.0 built this URL with wp_nonce_url(), which HTML-escapes it;
	 * wp_localize_script() used to decode that and the inline JSON does not,
	 * so the nonce arrived as `amp;_wpnonce` and the referer check failed.
	 */
	public function test_oauth_start_url_carries_a_nonce_that_verifies(): void {
		$config = $this->settings_config();
		$url    = (string) ( $config['oauthStartUrl'] ?? '' );

		$this->assertStringNotContainsString( '&amp;', $url );
		$this->assertStringStartsWith( admin_url( 'admin-post.php' ), $url );
		parse_str( (string) wp_parse_url( $url, PHP_URL_QUERY ), $query );
		$this->assertSame( 'wpsignal_oauth_start', $query['action'] ?? null );
		$this->assertNotFalse( wp_verify_nonce( (string) ( $query['_wpnonce'] ?? '' ), 'wpsignal_oauth_start' ), 'the nonce check_admin_referer() runs must pass' );
	}

	/**
	 * Nothing in the config is HTML-escaped: it is JSON, read by scripts, never printed as markup.
	 */
	public function test_no_settings_value_carries_html_entities(): void {
		$flat = array();
		array_walk_recursive(
			$this->settings_config(),
			static function ( $value ) use ( &$flat ): void {
				if ( is_string( $value ) ) {
					$flat[] = $value;
				}
			}
		);
		foreach ( $flat as $value ) {
			$this->assertStringNotContainsString( '&amp;', $value );
			$this->assertStringNotContainsString( '&#0', $value );
		}
	}
}
