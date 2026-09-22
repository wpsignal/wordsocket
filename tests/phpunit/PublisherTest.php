<?php
/**
 * Publisher: HMAC signing, encryption on every site, failure handling.
 */

use PHPUnit\Framework\Attributes\DataProvider;
use WPSignal\Notices;
use WPSignal\WPS;

final class PublisherTest extends WordSocketTestCase {

	protected function tearDown(): void {
		unset( $_SERVER['HTTPS'] );
		parent::tearDown();
	}

	public function test_publish_signs_body_dot_timestamp_with_the_site_secret(): void {
		$this->connect_site( 'sitekey1234567890', 'publishsecret' );
		unset( $_SERVER['HTTPS'] );
		$this->fake_http( static fn() => array( 200, array( 'ok' => true ) ) );

		$result = WPS::publish( 'events', 'demo.event', array( 'n' => 1 ) );

		$this->assertFalse( is_wp_error( $result ) );
		$this->assertCount( 1, $this->requests );
		$request = $this->requests[0];
		$this->assertStringEndsWith( '/publish', $request['url'] );

		$headers = $request['args']['headers'];
		$body    = $request['args']['body'];
		$this->assertSame( 'sitekey1234567890', $headers['X-WP-Signal-Key'] );
		$this->assertMatchesRegularExpression( '/^\d{13}$/', $headers['X-WP-Signal-Ts'] );
		$this->assertSame(
			hash_hmac( 'sha256', $body . '.' . $headers['X-WP-Signal-Ts'], 'publishsecret' ),
			$headers['X-WP-Signal-Sign']
		);

		// The signature covers the body as sent, which is the encrypted envelope.
		$decoded = json_decode( $body, true );
		$this->assertSame( 'events', $decoded['channel'] );
		$this->assertSame( 'encrypted', $decoded['event'] );
	}

	public function test_stats_is_a_signed_get_over_an_empty_body(): void {
		$this->connect_site( 'sitekey1234567890', 'publishsecret' );
		$this->fake_http( static fn() => array( 200, array( 'active_connections' => 7, 'max_connections' => 500 ) ) );
		$this->as_admin();

		list( $status, $data ) = $this->rest( 'GET', 'stats' );

		$this->assertSame( 200, $status );
		$this->assertSame( array( 'active_connections' => 7, 'max_connections' => 500 ), $data );
		$request = $this->requests[0];
		$this->assertStringEndsWith( '/site/stats', $request['url'] );
		$this->assertSame( 'GET', $request['args']['method'] );
		$headers = $request['args']['headers'];
		$this->assertSame( hash_hmac( 'sha256', '.' . $headers['X-WP-Signal-Ts'], 'publishsecret' ), $headers['X-WP-Signal-Sign'] );
	}

	public function test_stats_surfaces_the_server_error(): void {
		$this->connect_site( 'sitekey1234567890', 'publishsecret' );
		$this->fake_http( static fn() => array( 401, array( 'error' => 'unknown_site_key', 'message' => 'unknown site key' ) ) );
		$this->as_admin();

		list( $status, $data ) = $this->rest( 'GET', 'stats' );

		$this->assertSame( 401, $status );
		$this->assertSame( 'wpsignal_unknown_site_key', $data['code'] );
		$this->assertSame( 'unknown site key', $data['message'] );
	}

	/**
	 * Plain HTTP used to publish in the clear, because the browser had no way to
	 * decrypt there. The client now carries a pure-JS cipher for that case, so
	 * both schemes encrypt, and only the channel (which the relay routes on)
	 * stays readable.
	 *
	 * @return array<string, array{0: bool}>
	 */
	public static function schemes(): array {
		return array(
			'https'      => array( true ),
			'plain http' => array( false ),
		);
	}

	#[DataProvider( 'schemes' )]
	public function test_publish_encrypts_on_every_scheme_and_the_ciphertext_round_trips( bool $https ): void {
		$this->connect_site();
		if ( $https ) {
			$_SERVER['HTTPS'] = 'on';
		} else {
			unset( $_SERVER['HTTPS'] );
		}
		$this->assertSame( $https, is_ssl() );
		$this->fake_http( static fn() => array( 200, array( 'ok' => true ) ) );

		WPS::publish( 'events', 'secret.event', array( 'answer' => 42 ) );

		$body    = $this->requests[0]['args']['body'];
		$decoded = json_decode( $body, true );
		$this->assertSame( 'events', $decoded['channel'], 'the relay still needs the channel to route' );
		$this->assertSame( 'encrypted', $decoded['event'] );
		$this->assertSame( 1, $decoded['data']['v'] );
		$this->assertStringNotContainsString( 'secret.event', $body );
		$this->assertStringNotContainsString( '42', $body );

		$raw = base64_decode( $decoded['data']['p'] );
		$iv  = substr( $raw, 0, 12 );
		$tag = substr( $raw, -16 );
		$ct  = substr( $raw, 12, -16 );
		$key = WPS::instance()->config()->encryption_key();
		$this->assertNotSame( '', $key, 'encryption key derives from the site key and salts' );

		$plain = openssl_decrypt( $ct, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag );
		$this->assertSame(
			array( 'event' => 'secret.event', 'data' => array( 'answer' => 42 ) ),
			json_decode( $plain, true )
		);
	}

	public function test_quota_429_pauses_publishing_until_next_month_and_records_a_notice(): void {
		$this->connect_site();
		$this->fake_http( static fn() => array( 429, array( 'error' => 'quota_exceeded', 'message' => 'monthly message quota reached' ) ) );

		$first = WPS::publish( 'events', 'e', array() );
		$this->assertTrue( is_wp_error( $first ) );
		$this->assertSame( 'wpsignal_publish_error', $first->get_error_code() );

		$limits = get_option( 'wpsignal_limits' );
		$this->assertIsArray( $limits );
		$this->assertGreaterThan( time(), (int) $limits['messages_until'] );

		$notice = Notices::last();
		$this->assertSame( 'quota_exceeded', $notice['code'] );
		$this->assertStringContainsString( 'quota', Notices::describe( $notice ) );

		// Paused: no second HTTP request is made.
		$second = WPS::publish( 'events', 'e', array() );
		$this->assertSame( 'wpsignal_quota_exceeded', $second->get_error_code() );
		$this->assertCount( 1, $this->requests );
	}

	public function test_network_failure_records_unreachable_and_a_success_clears_it(): void {
		$this->connect_site();
		$fail = true;
		$this->fake_http(
			static function () use ( &$fail ) {
				return $fail ? new WP_Error( 'http_request_failed', 'cURL error 7' ) : array( 200, array( 'ok' => true ) );
			}
		);

		$this->assertTrue( is_wp_error( WPS::publish( 'events', 'e' ) ) );
		$this->assertSame( 'unreachable', Notices::last()['code'] );
		$this->assertStringContainsString( 'could not be reached', Notices::describe( Notices::last() ) );

		$fail = false;
		$this->assertFalse( is_wp_error( WPS::publish( 'events', 'e' ) ) );
		$this->assertNull( Notices::last() );
	}

	public function test_rejected_credentials_are_described_as_reconnect(): void {
		$this->connect_site();
		$this->fake_http( static fn() => array( 401, array( 'error' => 'invalid_signature', 'message' => 'bad signature' ) ) );

		WPS::publish( 'events', 'e' );

		$notice = Notices::last();
		$this->assertSame( 'invalid_signature', $notice['code'] );
		$this->assertStringContainsString( 'rejected', Notices::describe( $notice ) );
		$this->assertArrayNotHasKey( 'messages_until', (array) get_option( 'wpsignal_limits', array() ) );
	}

	public function test_client_is_not_enqueued_while_the_server_rejects_the_credentials(): void {
		$this->connect_site();
		$this->as_admin();
		$client = new \WPSignal\Client( WPS::instance()->config(), WPS::instance()->token() );

		wp_dequeue_script( 'wpsignal' );
		$client->enqueue();
		$this->assertTrue( wp_script_is( 'wpsignal', 'enqueued' ), 'connected site: client enqueued' );

		wp_dequeue_script( 'wpsignal' );
		Notices::record( 'unknown_site_key', 'unknown site key' );
		$this->assertTrue( Notices::credentials_rejected() );
		$client->enqueue();
		$this->assertFalse( wp_script_is( 'wpsignal', 'enqueued' ), 'rejected credentials: no client, no reconnect loop' );

		// A transient failure is not a rejection.
		Notices::clear();
		Notices::record( 'unreachable', 'cURL error 7' );
		$this->assertFalse( Notices::credentials_rejected() );
		$client->enqueue();
		$this->assertTrue( wp_script_is( 'wpsignal', 'enqueued' ) );
		wp_dequeue_script( 'wpsignal' );
	}

	public function test_publish_without_registration_returns_not_configured(): void {
		delete_option( 'wpsignal_site_key' );
		delete_option( 'wpsignal_site_secret' );
		$this->fake_http( static fn() => array( 200, array() ) );

		$result = WPS::publish( 'events', 'e' );

		$this->assertSame( 'wpsignal_not_configured', $result->get_error_code() );
		$this->assertCount( 0, $this->requests );
	}
}
