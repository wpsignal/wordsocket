<?php
/**
 * Token: JWT minting, the token route gate, and the connection REST routes.
 */

use WPSignal\Token;
use WPSignal\WPS;

final class TokenTest extends WordSocketTestCase {

	/** @var array|null Saved `wpsignal_allow_client` hooks (the local theme may open the client). */
	private $saved_allow_client = null;

	protected function tearDown(): void {
		if ( null !== $this->saved_allow_client ) {
			$GLOBALS['wp_filter']['wpsignal_allow_client'] = $this->saved_allow_client;
			$this->saved_allow_client                      = null;
		}
		parent::tearDown();
	}

	/** Detach every `wpsignal_allow_client` callback for the duration of a test. */
	private function without_allow_client_filter(): void {
		$this->saved_allow_client = $GLOBALS['wp_filter']['wpsignal_allow_client'] ?? false;
		unset( $GLOBALS['wp_filter']['wpsignal_allow_client'] );
	}

	private function token(): Token {
		return WPS::instance()->token();
	}

	public function test_mint_produces_an_hs256_jwt_scoped_to_the_site(): void {
		$this->connect_site( 'abc123', 'secret', 'jwt-secret-for-tests' );
		$this->as_admin();
		$user_id = get_current_user_id();

		$minted = $this->token()->mint();
		$this->assertIsArray( $minted );
		list( $header, $payload, $signature ) = self::jwt_parts( $minted['token'] );

		$this->assertSame( array( 'alg' => 'HS256', 'typ' => 'JWT' ), $header );
		$site_id = hash( 'sha256', 'site:abc123' );
		$this->assertSame( hash( 'sha256', 'tenant:abc123' ), $payload['tenant_id'] );
		$this->assertSame( $site_id, $payload['site_id'] );
		$this->assertSame( (string) $user_id, $payload['user_id'] );
		$this->assertSame( array( 'site:' . $site_id . ':' ), $payload['allowed_channel_prefixes'] );
		$this->assertSame( 300, $payload['exp'] - $payload['iat'] );
		$this->assertSame( $payload['exp'], $minted['exp'] );
		$this->assertSame( array( 'site:' . $site_id . ':events' ), $minted['channels'] );

		list( $h, $p ) = explode( '.', $minted['token'] );
		$expected      = rtrim( strtr( base64_encode( hash_hmac( 'sha256', "$h.$p", 'jwt-secret-for-tests', true ) ), '+/', '-_' ), '=' );
		$this->assertSame( $expected, $signature, 'signature is HMAC-SHA256 over header.payload with the site JWT secret' );
	}

	public function test_mint_filters_extend_channels_and_allowed_prefixes(): void {
		$this->connect_site( 'abc123' );
		$this->as_admin();
		$add_channel = static fn( $channels ) => array_merge( $channels, array( 'chat:room-1' ) );
		$add_prefix  = static fn( $prefixes ) => array_merge( $prefixes, array( 'chat:' ) );
		add_filter( 'wpsignal_token_channels', $add_channel );
		add_filter( 'wpsignal_token_channel_prefixes', $add_prefix );
		try {
			$minted = $this->token()->mint();
		} finally {
			remove_filter( 'wpsignal_token_channels', $add_channel );
			remove_filter( 'wpsignal_token_channel_prefixes', $add_prefix );
		}
		list( , $payload ) = self::jwt_parts( $minted['token'] );
		$this->assertContains( 'chat:room-1', $minted['channels'] );
		$this->assertContains( 'chat:', $payload['allowed_channel_prefixes'] );
	}

	public function test_mint_without_credentials_is_an_error(): void {
		delete_option( 'wpsignal_jwt_secret' );
		$this->assertTrue( is_wp_error( $this->token()->mint() ) );
	}

	public function test_token_route_requires_login_unless_the_filter_opens_it(): void {
		$this->connect_site();
		$this->without_allow_client_filter();

		wp_set_current_user( 0 );
		list( $status ) = $this->rest( 'GET', 'token' );
		$this->assertSame( 401, $status, 'anonymous callers get no token by default' );

		$this->as_admin();
		list( $status, $data ) = $this->rest( 'GET', 'token' );
		$this->assertSame( 200, $status );
		$this->assertArrayHasKey( 'token', $data );

		wp_set_current_user( 0 );
		add_filter( 'wpsignal_allow_client', '__return_true' );
		try {
			list( $status, $data ) = $this->rest( 'GET', 'token' );
		} finally {
			remove_filter( 'wpsignal_allow_client', '__return_true' );
		}
		$this->assertSame( 200, $status, 'the filter opens the route to visitors' );
		list( , $payload ) = self::jwt_parts( $data['token'] );
		$this->assertSame( '0', $payload['user_id'] );
	}

	public function test_settings_masks_the_api_key_and_connect_accepts_the_mask(): void {
		$this->as_admin();
		update_option( 'wpsignal_api_key', str_repeat( 'a', 60 ) . 'wxyz' );
		$this->connect_site();
		// verify_site_exists(): a dummy signature on a live site answers invalid_signature.
		$this->fake_http(
			static function ( $url ) {
				if ( str_ends_with( $url, '/publish' ) ) {
					return array( 401, array( 'error' => 'invalid_signature', 'message' => 'bad signature' ) );
				}
				return array( 200, array( 'site_key' => 'newkey', 'publish_secret' => 'newsecret', 'jwt_secret' => 'newjwt' ) );
			}
		);

		list( $status, $settings ) = $this->rest( 'GET', 'settings' );
		$this->assertSame( 200, $status );
		$this->assertSame( '****wxyz', $settings['api_key'] );
		$this->assertTrue( $settings['is_connected'] );
		$this->assertNull( $settings['last_error'] );

		list( $status, $data ) = $this->rest( 'POST', 'connect', array( 'api_key' => '****wxyz' ) );
		$this->assertSame( 200, $status, wp_json_encode( $data ) );
		$register = end( $this->requests );
		$this->assertStringEndsWith( '/api/sites/register', $register['url'] );
		$this->assertSame( 'Bearer ' . str_repeat( 'a', 60 ) . 'wxyz', $register['args']['headers']['Authorization'] );
		$this->assertSame( 'newkey', get_option( 'wpsignal_site_key' ) );
		$this->assertSame( 'newsecret', get_option( 'wpsignal_site_secret' ) );
	}

	public function test_connect_validates_the_key_and_passes_server_errors_through(): void {
		$this->as_admin();
		foreach ( array( 'wpsignal_api_key', 'wpsignal_site_key', 'wpsignal_site_secret', 'wpsignal_jwt_secret' ) as $option ) {
			delete_option( $option );
		}
		$this->fake_http( static fn() => array( 403, array( 'error' => 'site_limit_reached', 'message' => 'disconnect example.com first' ) ) );

		list( $status, $data ) = $this->rest( 'POST', 'connect', array( 'api_key' => 'short' ) );
		$this->assertSame( 400, $status );
		$this->assertSame( 'wpsignal_invalid_api_key', $data['code'] );
		$this->assertCount( 0, $this->requests, 'invalid keys never reach the server' );

		list( $status, $data ) = $this->rest( 'POST', 'connect', array( 'api_key' => str_repeat( 'b', 64 ) ) );
		$this->assertSame( 403, $status );
		$this->assertSame( 'wpsignal_site_limit_reached', $data['code'] );
		$this->assertSame( 'disconnect example.com first', $data['message'] );
		$this->assertSame( '', get_option( 'wpsignal_site_key', '' ), 'nothing is stored on refusal' );
	}

	public function test_disconnect_keeps_credentials_when_the_server_refuses_and_clears_on_404(): void {
		$this->as_admin();
		$this->connect_site( 'keepme' );
		$this->fake_http( static fn() => array( 403, array( 'error' => 'unauthorized', 'message' => 'not your site' ) ) );

		list( $status, $data ) = $this->rest( 'POST', 'disconnect' );
		$this->assertSame( 403, $status );
		$this->assertSame( 'wpsignal_unauthorized', $data['code'] );
		$this->assertSame( 'keepme', get_option( 'wpsignal_site_key' ), 'credentials survive a refusal' );

		remove_all_filters( 'pre_http_request' );
		$this->fake_http( static fn() => array( 404, array( 'error' => 'not_found', 'message' => 'site not found' ) ) );
		list( $status, $data ) = $this->rest( 'POST', 'disconnect' );
		$this->assertSame( 200, $status );
		$this->assertTrue( $data['ok'] );
		$this->assertSame( '', get_option( 'wpsignal_site_key', '' ), 'a site the server already forgot is cleared locally' );

		// A regenerated dashboard key: the server rejects the stored key, and
		// there is nothing left to disconnect on its side.
		$this->connect_site( 'revoked' );
		update_option( 'wpsignal_api_key', str_repeat( 'a', 64 ) );
		remove_all_filters( 'pre_http_request' );
		$this->fake_http( static fn() => array( 401, array( 'error' => 'invalid_api_key', 'message' => 'invalid API key' ) ) );
		list( $status ) = $this->rest( 'POST', 'disconnect' );
		$this->assertSame( 200, $status );
		$this->assertSame( '', get_option( 'wpsignal_site_key', '' ), 'a rejected key clears the local copy' );
		$this->assertSame( '', get_option( 'wpsignal_api_key', '' ) );
	}

	public function test_get_settings_reports_disconnected_for_revoked_credentials(): void {
		$this->as_admin();
		$this->connect_site();
		$this->fake_http( static fn() => array( 401, array( 'error' => 'unknown_site_key', 'message' => 'unknown site key' ) ) );

		list( , $settings ) = $this->rest( 'GET', 'settings' );
		$this->assertFalse( $settings['is_connected'] );
		$this->assertSame( '', $settings['site_key'] );

		remove_all_filters( 'pre_http_request' );
		$this->fake_http( static fn() => array( 401, array( 'error' => 'account_deactivated', 'message' => 'deactivated' ) ) );
		list( , $settings ) = $this->rest( 'GET', 'settings' );
		$this->assertFalse( $settings['is_connected'] );

		remove_all_filters( 'pre_http_request' );
		$this->fake_http( static fn() => new WP_Error( 'http_request_failed', 'timeout' ) );
		list( , $settings ) = $this->rest( 'GET', 'settings' );
		$this->assertTrue( $settings['is_connected'], 'an unreachable server is not a revoked site' );
	}

	public function test_post_settings_casts_the_boolean_and_requires_it(): void {
		$this->as_admin();

		list( $status, $data ) = $this->rest( 'POST', 'settings', array( 'yjs_provider_enabled' => 'false' ) );
		$this->assertSame( 200, $status );
		$this->assertFalse( $data['yjs_provider_enabled'] );
		$this->assertFalse( WPS::instance()->config()->yjs_provider_enabled() );

		list( $status ) = $this->rest( 'POST', 'settings', array( 'yjs_provider_enabled' => true ) );
		$this->assertSame( 200, $status );
		$this->assertTrue( WPS::instance()->config()->yjs_provider_enabled() );

		list( $status, $data ) = $this->rest( 'POST', 'settings' );
		$this->assertSame( 400, $status );
		$this->assertSame( 'rest_missing_callback_param', $data['code'] );
	}

	public function test_mask_api_key(): void {
		$this->assertSame( '', Token::mask_api_key( '' ) );
		$this->assertSame( '****wxyz', Token::mask_api_key( 'abcdefwxyz' ) );
	}
}
