<?php
/**
 * Plugin Name:       WordSocket Stub Extension
 * Description:       The smallest possible WordSocket extension. Used by the plugin's test suites and as the reference for the extension API.
 * Version:           1.0.0
 * Requires Plugins:  wordsocket
 * Text Domain:       wordsocket-stub-extension
 *
 * @package WPSignal\Extensions\Stub
 */

namespace WPSignal\Extensions\Stub;

use WPSignal\WPS;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const SLUG = 'wordsocket-stub-extension';

/**
 * 1. Catalogue entry, so the Extensions tab lists the extension even before
 *    its script runs, and a reserved channel namespace only administrators
 *    may subscribe to.
 */
add_action(
	'wpsignal_loaded',
	function () {
		WPS::instance()->extensions()->register(
			SLUG,
			array(
				'title'       => 'Stub Extension',
				'description' => 'Proves an extension can render inside WordSocket.',
				'version'     => '1.0.0',
				'docs_url'    => 'https://wpsignal.io/docs/js-api',
				'file'        => plugin_basename( __FILE__ ),
			)
		);
		WPS::instance()->channels()->reserve( 'stub:private', 'manage_options' );

		/*
		 * 1b. A condition and an action for the rules engine (0.31): the PHP
		 * half describes them to the builder; `stub-client.js` does the work.
		 */
		if ( method_exists( WPS::class, 'rules' ) ) {
			WPS::rules()->condition(
				'stub_flag',
				array(
					'label'     => 'Stub flag',
					'operators' => array( 'is' ),
					'value'     => 'boolean',
					'source'    => SLUG,
				)
			);
			WPS::rules()->action(
				'stub_log',
				array(
					'label'       => 'Log to the stub',
					'description' => 'Appends the firing to window.__stubFired.',
					'params'      => array(
						'message' => array(
							'type'  => 'text',
							'label' => 'Message',
						),
					),
					'source'      => SLUG,
				)
			);
		}
	}
);

// Where a firing goes: a transient the test suites read.
add_action(
	'wpsignal_rule_fired',
	function ( array $report ) {
		set_transient( 'stub_rule_fired', $report, MINUTE_IN_SECONDS );
	}
);

// The browser halves, on every page the client is on.
add_action(
	'wp_enqueue_scripts',
	function () {
		if ( wp_script_is( 'wpsignal', 'enqueued' ) ) {
			wp_enqueue_script( SLUG . '-client', plugins_url( 'stub-client.js', __FILE__ ), array( 'wpsignal' ), '1.0.0', true );
		}
	},
	20
);

/**
 * A public channel. Once any namespace is reserved (above), tokens list
 * channels explicitly, so every channel an extension subscribes to must be
 * registered here.
 */
add_filter(
	'wpsignal_token_channels',
	function ( array $channels, int $user_id, string $site_id ) {
		unset( $user_id );
		$channels[] = 'site:' . $site_id . ':stub:public';
		return $channels;
	},
	10,
	3
);

/**
 * 2. The settings-page script, only on WordSocket's screen and only after the
 *    settings bundle (`wpsignal-settings`) so `window.wordsocket` exists.
 */
add_action(
	'wordsocket_settings_enqueue',
	function () {
		wp_enqueue_script(
			SLUG,
			plugins_url( 'stub.js', __FILE__ ),
			array( 'wpsignal-settings', 'wp-plugins', 'wp-element', 'wp-components' ),
			'1.0.0',
			true
		);
	}
);
