<?php
/**
 * Config: values derived from the relay's base URL.
 */

use WPSignal\Config;
use WPSignal\WPS;

final class ConfigTest extends WordSocketTestCase {

	public function test_endpoints_take_the_relays_scheme_not_the_pages(): void {
		$this->assertSame(
			array(
				'ws'  => 'wss://api.wpsignal.io/ws',
				'sse' => 'https://api.wpsignal.io/sse',
			),
			Config::endpoints_for( 'https://api.wpsignal.io' )
		);
		// A plain HTTP relay, such as a local server without TLS, gets a plain socket.
		$this->assertSame(
			array(
				'ws'  => 'ws://localhost:3001/ws',
				'sse' => 'http://localhost:3001/sse',
			),
			Config::endpoints_for( 'http://localhost:3001/' )
		);
		// A relay under a path prefix keeps it.
		$this->assertSame( 'wss://example.com/relay/ws', Config::endpoints_for( 'https://example.com/relay' )['ws'] );

		// And the site's own endpoints are built from its configured base URL, whatever that is here.
		$config = WPS::instance()->config();
		$this->assertSame( Config::endpoints_for( $config->base_url() ), $config->endpoints() );
	}

	/*
	 * Why endpoints_for() names its protocols: `ws` and `wss` are not in
	 * wp_allowed_protocols(), so without them sanitize_url() drops a socket URL
	 * entirely and the browser gets an empty endpoint.
	 */
	public function test_socket_schemes_need_explicit_protocols_to_survive_sanitizing(): void {
		$this->assertSame( '', sanitize_url( 'wss://relay.example/ws' ) );
		$this->assertSame( 'wss://relay.example/ws', sanitize_url( 'wss://relay.example/ws', array( 'ws', 'wss' ) ) );
	}
}
