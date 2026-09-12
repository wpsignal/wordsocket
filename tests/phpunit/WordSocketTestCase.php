<?php
/**
 * Shared fixture for WordSocket integration tests.
 */

use PHPUnit\Framework\TestCase;

abstract class WordSocketTestCase extends TestCase {

	/** Options every test may touch; snapshotted in setUp and restored in tearDown. */
	private const OPTIONS = array(
		'wpsignal_api_key',
		'wpsignal_site_key',
		'wpsignal_site_secret',
		'wpsignal_jwt_secret',
		'wpsignal_limits',
		'wpsignal_last_publish_error',
		'wpsignal_yjs_provider_enabled',
	);

	/** @var array<string, mixed> */
	private array $snapshot = array();

	/** @var array<int, array> Requests captured by fake_http(). */
	protected array $requests = array();

	/** @var callable|null */
	private $http_filter = null;

	protected function setUp(): void {
		parent::setUp();
		foreach ( self::OPTIONS as $name ) {
			$this->snapshot[ $name ] = get_option( $name, self::MISSING );
		}
		$this->requests = array();
		\WPSignal\Notices::clear();
		wp_set_current_user( 0 );
	}

	protected function tearDown(): void {
		if ( $this->http_filter ) {
			remove_filter( 'pre_http_request', $this->http_filter, 10 );
			$this->http_filter = null;
		}
		foreach ( $this->snapshot as $name => $value ) {
			if ( self::MISSING === $value ) {
				delete_option( $name );
			} else {
				update_option( $name, $value );
			}
		}
		\WPSignal\Notices::clear();
		wp_set_current_user( 0 );
		parent::tearDown();
	}

	private const MISSING = '__wordsocket_test_missing__';

	/** Store a fake registration so the plugin considers itself connected. */
	protected function connect_site( string $site_key = 'testsitekey0000', string $secret = 'testsecret', string $jwt = 'testjwtsecret' ): void {
		update_option( 'wpsignal_site_key', $site_key );
		update_option( 'wpsignal_site_secret', $secret );
		update_option( 'wpsignal_jwt_secret', $jwt );
	}

	/**
	 * Intercept outbound HTTP. `$responder` receives ($url, $args) and returns
	 * either a WP_Error or [status, body-array-or-string]. Every request is
	 * recorded in $this->requests.
	 */
	protected function fake_http( callable $responder ): void {
		$this->http_filter = function ( $pre, $args, $url ) use ( $responder ) {
			$this->requests[] = array( 'url' => $url, 'args' => $args );
			$result           = $responder( $url, $args );
			if ( is_wp_error( $result ) ) {
				return $result;
			}
			list( $status, $body ) = $result;
			return array(
				'response' => array( 'code' => $status, 'message' => '' ),
				'headers'  => array(),
				'body'     => is_string( $body ) ? $body : wp_json_encode( $body ),
				'cookies'  => array(),
			);
		};
		add_filter( 'pre_http_request', $this->http_filter, 10, 3 );
	}

	/** Run a plugin REST route in-process; returns [status, data]. */
	protected function rest( string $method, string $route, array $params = array() ): array {
		$request = new WP_REST_Request( $method, '/wpsignal/v1/' . ltrim( $route, '/' ) );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}
		$response = rest_do_request( $request );
		return array( $response->get_status(), $response->get_data() );
	}

	protected function as_admin(): void {
		$admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID' ) );
		$this->assertNotEmpty( $admins, 'the target site needs an administrator' );
		wp_set_current_user( (int) $admins[0] );
	}

	/** Decode a JWT payload without verifying (tests verify separately). */
	protected static function jwt_parts( string $token ): array {
		list( $h, $p, $s ) = explode( '.', $token );
		$decode = static fn( $b ) => json_decode( base64_decode( strtr( $b, '-_', '+/' ) ), true );
		return array( $decode( $h ), $decode( $p ), $s );
	}
}
