<?php
/**
 * Rules (0.31): the registry, the shipped defaults, the save and its broadcast,
 * validation, the prompt route, the firing report, and the client config.
 */

use WPSignal\Rules;
use WPSignal\WPS;

final class RulesTest extends WordSocketTestCase {

	private const V = '0b2b6a4e-9f0a-4c7a-8f1c-1d2e3f4a5b6c';
	private const N = '7c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

	/** @var array<string, mixed> */
	private array $saved_options = array();

	/** @var int[] */
	private array $posts = array();

	protected function setUp(): void {
		parent::setUp();
		foreach ( array( 'wpsignal_rules' ) as $name ) {
			$this->saved_options[ $name ] = get_option( $name, '__missing__' );
			delete_option( $name );
		}
	}

	protected function tearDown(): void {
		foreach ( $this->saved_options as $name => $value ) {
			if ( '__missing__' === $value ) {
				delete_option( $name );
			} else {
				update_option( $name, $value );
			}
		}
		foreach ( $this->posts as $id ) {
			wp_delete_post( $id, true );
		}
		parent::tearDown();
	}

	private function rules(): Rules {
		return WPS::rules();
	}

	/** A valid rule the tests start from. */
	private function rule( array $overrides = array() ): array {
		return array_merge(
			array(
				'id'         => 'r1',
				'name'       => 'Readers who linger',
				'enabled'    => true,
				'frequency'  => 'visitor',
				'conditions' => array(
					'all' => array(
						array(
							'condition' => 'page_kind',
							'op'        => 'is',
							'value'     => 'post',
						),
						array(
							'condition' => 'dwell',
							'op'        => 'at_least',
							'value'     => 30,
						),
					),
				),
				'actions'    => array(
					array(
						'action'       => 'show',
						'presentation' => array(
							'type'    => 'toast',
							'pattern' => 0,
							'text'    => 'Keep reading, {site.name}',
						),
					),
				),
			),
			$overrides
		);
	}

	private function make_pattern( string $status = 'publish' ): int {
		$id            = wp_insert_post(
			array(
				'post_type'    => 'wp_block',
				'post_status'  => $status,
				'post_title'   => 'PHPUnit prompt',
				'post_content' => '<!-- wp:paragraph --><p>Pattern says hi</p><!-- /wp:paragraph -->',
			)
		);
		$this->posts[] = (int) $id;
		return (int) $id;
	}

	public function test_the_default_vocabulary_lists_every_built_in_with_operators(): void {
		$vocabulary = $this->rules()->vocabulary();
		$conditions = array_column( $vocabulary['conditions'], null, 'key' );
		foreach ( array( 'page_kind', 'page_id', 'term_id', 'taxonomy', 'dwell', 'time_hidden', 'pages_viewed', 'visited', 'site_hour', 'hour', 'weekday', 'visitor', 'logged_in', 'device' ) as $key ) {
			$this->assertArrayHasKey( $key, $conditions, $key );
			$this->assertNotEmpty( $conditions[ $key ]['operators'], "$key has operators" );
		}
		$this->assertSame( array( 'at_least', 'at_most' ), array_column( $conditions['dwell']['operators'], 'key' ) );
		$this->assertSame( 'select', $conditions['page_kind']['value'] );
		$this->assertArrayNotHasKey( 'category', $conditions['page_kind']['options'], 'taxonomy archives have their own condition' );
		$this->assertArrayHasKey( 'category', $conditions['taxonomy']['options'] );
		$this->assertSame( 'post', array_key_first( $conditions['page_kind']['options'] ), 'post leads, as the builder default' );
		$actions = array_column( $vocabulary['actions'], null, 'key' );
		$this->assertSame( array( 'show' ), array_keys( $actions ) );
		$this->assertSame( array( 'presentation', 'after' ), array_keys( $actions['show']['params'] ), 'how, with what text or pattern, and the delay every action has' );
		$this->assertSame( 'after', $actions['show']['params']['after']['prefix'] );
		$kinds = $this->rules()->kinds();
		$this->assertArrayHasKey( 'post', $kinds );
		$this->assertArrayHasKey( 'home', $kinds );
		$this->assertArrayHasKey( 'category', $kinds );
	}

	public function test_an_extension_registers_a_condition_and_an_action(): void {
		$this->rules()->condition(
			'phpunit_flag',
			array(
				'label'     => 'PHPUnit flag',
				'operators' => array( 'is' ),
				'value'     => 'boolean',
				'source'    => 'phpunit',
			)
		);
		$this->rules()->action(
			'phpunit_log',
			array(
				'label'  => 'Log',
				'params' => array(
					'message' => array( 'type' => 'text' ),
				),
				'live'   => true,
				'source' => 'phpunit',
			)
		);
		$vocabulary = $this->rules()->vocabulary();
		$this->assertSame( 'page_kind', $vocabulary['conditions'][0]['key'], 'WordSocket\'s own entries lead, whatever registered first' );
		$condition = array_column( $vocabulary['conditions'], null, 'key' )['phpunit_flag'];
		$this->assertSame( 'phpunit', $condition['source'] );
		$this->assertSame(
			array(
				array(
					'key'   => 'is',
					'label' => 'is',
				),
			),
			$condition['operators']
		);
		$action = array_column( $vocabulary['actions'], null, 'key' )['phpunit_log'];
		$this->assertTrue( $action['live'] );
		$this->assertSame( 'text', $action['params']['message']['type'] );
		$this->rules()->condition( 'Bad Key', array() );
		$this->assertArrayNotHasKey( 'Bad Key', array_column( $this->rules()->vocabulary()['conditions'], null, 'key' ) );
	}

	public function test_shipped_defaults_appear_disabled_and_a_removed_one_stays_removed(): void {
		$shipped = fn( array $rules ): array => array_merge(
			$rules,
			array(
				$this->rule(
					array(
						'id'      => 'ext-rule',
						'enabled' => true,
						'source'  => 'ext',
					)
				),
			)
		);
		add_filter( 'wpsignal_default_rules', $shipped );
		try {
			$all = $this->rules()->all();
			$this->assertCount( 1, $all );
			$this->assertSame( 'ext-rule', $all[0]['id'] );
			$this->assertFalse( $all[0]['enabled'], 'shipped rules are off until saved' );
			$this->assertSame( array(), $all[0]['unavailable'] );
			$this->assertSame( array(), $this->rules()->enabled(), 'an unsaved default never reaches browsers' );

			// Saving the list without it removes it for good.
			$this->rules()->save( array(), null );
			$this->assertSame( array( 'ext-rule' ), $this->rules()->saved()['removed'] );
			$this->assertSame( array(), $this->rules()->all() );

			// Saving it back makes it a saved rule again.
			$clean = $this->rules()->validate( array( $this->rule( array( 'id' => 'ext-rule' ) ) ) );
			$this->rules()->save( $clean );
			$this->assertSame( array(), $this->rules()->saved()['removed'] );
			$this->assertCount( 1, $this->rules()->enabled() );
		} finally {
			remove_filter( 'wpsignal_default_rules', $shipped );
		}
	}

	public function test_posting_rules_saves_bumps_versions_and_broadcasts_enabled_rules_only(): void {
		$this->connect_site();
		$this->fake_http( static fn() => array( 200, array( 'ok' => true ) ) );
		$this->as_admin();

		list( $status, $data ) = $this->rest(
			'POST',
			'rules',
			array(
				'rules' => array(
					$this->rule(),
					$this->rule(
						array(
							'id'      => 'r2',
							'enabled' => false,
						)
					),
				),
			)
		);
		$this->assertSame( 200, $status, wp_json_encode( $data ) );
		$this->assertSame( 1, $data['version'] );
		$this->assertCount( 2, $data['rules'] );
		$this->assertSame( 1, $data['rules'][0]['rev'] );
		$this->assertSame( array( 'conditions', 'actions', 'contexts' ), array_keys( $data['vocabulary'] ) );
		$this->assertArrayHasKey( 'kinds', $data );

		$publishes = array_filter( $this->requests, static fn( array $r ): bool => str_ends_with( (string) $r['url'], '/publish' ) );
		$this->assertCount( 1, $publishes );
		$event = $this->open_publish( (string) end( $publishes )['args']['body'] );
		$this->assertSame( 'rules.updated', $event['event'] );
		$this->assertSame( 'events', $event['channel'], 'the site events channel, which every page receives' );
		$this->assertSame( 1, $event['data']['version'] );
		$this->assertSame( array( 'r1' ), array_column( $event['data']['rules'], 'id' ), 'disabled rules never leave wp-admin' );
		$this->assertArrayNotHasKey( 'recovery', $event['data'], 'the taste is each rule\'s own params since 2026-10-19' );

		// A save with the same rules keeps their revisions; an edit bumps the edited one only.
		$rules            = $data['rules'];
		$rules[1]['name'] = 'Renamed';
		list( , $again )  = $this->rest( 'POST', 'rules', array( 'rules' => $rules ) );
		$this->assertSame( 2, $again['version'] );
		$this->assertSame( 1, $again['rules'][0]['rev'] );
		$this->assertSame( 2, $again['rules'][1]['rev'] );
	}

	public function test_invalid_rules_are_refused_naming_the_rule(): void {
		$this->as_admin();
		$cases = array(
			'unknown condition' => array(
				'conditions' => array(
					'all' => array(
						array(
							'condition' => 'nope',
							'op'        => 'is',
							'value'     => 1,
						),
					),
				),
			),
			'bad operator'      => array(
				'conditions' => array(
					'all' => array(
						array(
							'condition' => 'dwell',
							'op'        => 'is',
							'value'     => 1,
						),
					),
				),
			),
			'wrong value type'  => array(
				'conditions' => array(
					'all' => array(
						array(
							'condition' => 'dwell',
							'op'        => 'at_least',
							'value'     => 'soon',
						),
					),
				),
			),
			'unknown kind'      => array(
				'conditions' => array(
					'all' => array(
						array(
							'condition' => 'page_kind',
							'op'        => 'is',
							'value'     => 'spaceship',
						),
					),
				),
			),
			'unknown action'    => array(
				'actions' => array(
					array( 'action' => 'launch' ),
				),
			),
			'draft pattern'     => array(
				'actions' => array(
					array(
						'action'       => 'show',
						'presentation' => array(
							'type'    => 'modal',
							'pattern' => $this->make_pattern( 'draft' ),
							'text'    => 'x',
						),
					),
				),
			),
			'empty group'       => array(
				'conditions' => array(
					'any' => array(
						array(
							'condition' => 'page_kind',
							'op'        => 'is',
							'value'     => 'post',
						),
						array( 'all' => array() ),
					),
				),
			),
			'no name'           => array( 'name' => '' ),
			'bad frequency'     => array( 'frequency' => 'daily' ),
		);
		foreach ( $cases as $label => $overrides ) {
			list( $status, $data ) = $this->rest( 'POST', 'rules', array( 'rules' => array( $this->rule( $overrides ) ) ) );
			$this->assertSame( 400, $status, $label );
			$this->assertSame( 'wpsignal_invalid_rules', $data['code'], $label );
			$this->assertSame( 'r1', $data['data']['rule'], $label );
		}
		$this->assertSame( 0, $this->rules()->saved()['version'], 'nothing was saved' );
		list( $status ) = $this->rest( 'POST', 'rules', array() );
		$this->assertSame( 400, $status, 'neither rules nor recovery' );
	}

	public function test_the_staff_routes_refuse_a_subscriber(): void {
		$subscriber = wp_insert_user(
			array(
				'user_login' => 'wps-rules-sub-' . wp_generate_password( 6, false ),
				'user_pass'  => wp_generate_password(),
				'role'       => 'subscriber',
			)
		);
		try {
			wp_set_current_user( (int) $subscriber );
			list( $status ) = $this->rest( 'GET', 'rules' );
			$this->assertSame( 403, $status );
			list( $status ) = $this->rest( 'POST', 'rules', array( 'rules' => array() ) );
			$this->assertSame( 403, $status );
		} finally {
			wp_set_current_user( 0 );
			require_once ABSPATH . 'wp-admin/includes/user.php';
			wp_delete_user( (int) $subscriber );
		}
	}

	public function test_the_live_route_is_public_and_answers_the_broadcast_uncached(): void {
		$this->connect_site();
		$this->fake_http( static fn() => array( 200, array( 'ok' => true ) ) );
		$clean = $this->rules()->validate(
			array(
				$this->rule(),
				$this->rule(
					array(
						'id'      => 'r2',
						'enabled' => false,
					)
				),
			)
		);
		$this->rules()->save( $clean );

		wp_set_current_user( 0 );
		$response = rest_do_request( new WP_REST_Request( 'GET', '/wpsignal/v1/rules/live' ) );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $this->rules()->broadcast(), $response->get_data() );
		$this->assertSame( array( 'r1' ), array_column( $response->get_data()['rules'], 'id' ) );
		$this->assertSame( 'no-store', $response->get_headers()['Cache-Control'] );
		$this->assertStringEndsWith( '/wpsignal/v1/rules/live', $this->rules()->config()['liveUrl'] );
	}

	public function test_the_prompt_route_serves_a_referenced_pattern_and_nothing_else(): void {
		$this->connect_site();
		$this->fake_http( static fn() => array( 200, array( 'ok' => true ) ) );
		$pattern = $this->make_pattern();
		$other   = $this->make_pattern();
		$clean   = $this->rules()->validate(
			array(
				$this->rule(
					array(
						'actions' => array(
							array(
								'action'       => 'show',
								'presentation' => array(
									'type'    => 'modal',
									'pattern' => $pattern,
									'text'    => 'fallback',
								),
							),
						),
					)
				),
			)
		);
		$this->assertIsArray( $clean );
		$this->rules()->save( $clean );

		wp_set_current_user( 0 );
		$response = rest_do_request( new WP_REST_Request( 'GET', '/wpsignal/v1/prompt/' . $pattern ) );
		$this->assertSame( 200, $response->get_status() );
		$this->assertMatchesRegularExpression( '/<p[^>]*>Pattern says hi<\/p>/', $response->get_data()['html'] );
		$this->assertSame( 'public, max-age=3600', $response->get_headers()['Cache-Control'] );

		$response = rest_do_request( new WP_REST_Request( 'GET', '/wpsignal/v1/prompt/' . $other ) );
		$this->assertSame( 404, $response->get_status(), 'a pattern no rule names is not served' );

		// Paused: the pattern is no longer public, since no live moment shows it.
		$clean[0]['enabled'] = false;
		$this->rules()->save( $clean );
		$response = rest_do_request( new WP_REST_Request( 'GET', '/wpsignal/v1/prompt/' . $pattern ) );
		$this->assertSame( 404, $response->get_status(), 'a pattern only a paused moment names is not served' );
		$clean[0]['enabled'] = true;
		$this->rules()->save( $clean );
		wp_update_post(
			array(
				'ID'          => $pattern,
				'post_status' => 'draft',
			)
		);
		$response = rest_do_request( new WP_REST_Request( 'GET', '/wpsignal/v1/prompt/' . $pattern ) );
		$this->assertSame( 404, $response->get_status(), 'a draft is not served' );
	}

	public function test_editing_a_shown_pattern_moves_the_version_and_tells_every_browser(): void {
		$this->connect_site();
		$this->fake_http( static fn() => array( 200, array( 'ok' => true ) ) );
		$pattern = $this->make_pattern();
		$other   = $this->make_pattern();
		$clean   = $this->rules()->validate(
			array(
				$this->rule(
					array(
						'actions' => array(
							array(
								'action'       => 'show',
								'presentation' => array(
									'type'    => 'modal',
									'pattern' => $pattern,
									'text'    => '',
								),
							),
						),
					)
				),
			)
		);
		$this->assertIsArray( $clean );
		$saved   = $this->rules()->save( $clean );
		$version = (int) $saved['version'];
		// The `rules.updated` publishes so far; a post save also publishes the site's own post events, which do not count.
		$updates = fn(): array => array_values(
			array_filter(
				$this->requests,
				fn( array $r ): bool => str_ends_with( (string) $r['url'], '/publish' ) && 'rules.updated' === $this->open_publish( (string) $r['args']['body'] )['event']
			)
		);
		$before  = count( $updates() );

		wp_update_post(
			array(
				'ID'           => $other,
				'post_content' => '<!-- wp:paragraph --><p>Nobody shows this</p><!-- /wp:paragraph -->',
			)
		);
		$this->assertSame( $version, (int) $this->rules()->saved()['version'], 'a pattern no moment shows moves nothing' );
		$this->assertCount( $before, $updates() );

		wp_update_post(
			array(
				'ID'           => $pattern,
				'post_content' => '<!-- wp:paragraph --><p>Pattern says bye</p><!-- /wp:paragraph -->',
			)
		);
		$saved = $this->rules()->saved();
		$this->assertSame( $version + 1, (int) $saved['version'], 'the version moves, so the cached markup is fetched again' );
		$this->assertSame( 1, (int) $saved['rules'][0]['rev'], 'no rule is re-armed' );
		$heard = $updates();
		$this->assertCount( $before + 1, $heard, 'every open browser hears rules.updated' );
		$event = $this->open_publish( (string) end( $heard )['args']['body'] );
		$this->assertSame( $version + 1, (int) $event['data']['version'] );
	}

	public function test_a_firing_report_of_an_enabled_rule_is_handed_to_the_action(): void {
		$this->connect_site();
		$this->fake_http( static fn() => array( 200, array( 'ok' => true ) ) );
		$clean = $this->rules()->validate( array( $this->rule() ) );
		$this->assertIsArray( $clean );
		$this->rules()->save( $clean );
		$seen     = array();
		$listener = static function ( array $report ) use ( &$seen ): void {
			$seen[] = $report;
		};
		add_action( 'wpsignal_rule_fired', $listener );
		try {
			list( $status, $data ) = $this->rest(
				'POST',
				'fired',
				array(
					'v'      => strtoupper( self::V ),
					'n'      => self::N,
					'rule'   => 'r1',
					'action' => 'show',
					'step'   => 3,
					'data'   => array( 'b' => 'cart-1' ),
				)
			);
			$this->assertSame( 200, $status, wp_json_encode( $data ) );
			$this->assertSame(
				array(
					'visitor'    => self::V,
					'journey_id' => self::N,
					'rule_id'    => 'r1',
					'action'     => 'show',
					'step'       => 3,
					'user_id'    => 0,
					'data'       => array( 'b' => 'cart-1' ),
				),
				$seen[0]
			);
			list( $status ) = $this->rest(
				'POST',
				'fired',
				array(
					'v'      => 'nope',
					'n'      => self::N,
					'rule'   => 'r1',
					'action' => 'show',
				)
			);
			$this->assertSame( 400, $status );
			$this->assertCount( 1, $seen, 'a bad id never reaches the action' );
			foreach ( array( array( 'rule' => 'r2', 'action' => 'show' ), array( 'rule' => 'r1', 'action' => 'alert_staff' ) ) as $unknown ) {
				list( $status ) = $this->rest( 'POST', 'fired', array( 'v' => self::V, 'n' => self::N ) + $unknown );
				$this->assertSame( 404, $status, wp_json_encode( $unknown ) );
			}
			$clean[0]['enabled'] = false;
			$this->rules()->save( $clean );
			list( $status ) = $this->rest( 'POST', 'fired', array( 'v' => self::V, 'n' => self::N, 'rule' => 'r1', 'action' => 'show' ) );
			$this->assertSame( 404, $status, 'a paused moment cannot have fired' );
			$this->assertCount( 1, $seen, 'a rule that is not saved and enabled never reaches the action' );
		} finally {
			remove_action( 'wpsignal_rule_fired', $listener );
		}
	}

	public function test_a_rule_saved_with_the_old_dynamic_action_reads_as_show_grabbing_attention(): void {
		$rule = $this->rule(
			array(
				'actions' => array(
					array(
						'action' => 'dynamic',
						'params' => array(
							'content'      => array(
								'text'    => 'Back?',
								'pattern' => 0,
							),
							'presentation' => 'banner',
						),
					),
				),
			)
		);
		update_option(
			'wpsignal_rules',
			array(
				'version' => 1,
				'rules'   => array( $rule ),
				'removed' => array(),
			),
			false
		);
		$read = $this->rules()->saved()['rules'][0];
		$this->assertSame( 'show', $read['actions'][0]['action'] );
		$this->assertTrue( $read['attention']['enabled'], 'the switch moved to the moment' );
		$this->assertArrayNotHasKey( 'params', $read['actions'][0], 'params sit beside the action key' );
		$this->assertSame( 'banner', $read['actions'][0]['presentation']['type'], 'the old presentation and content read as one object' );
		$this->assertSame( 'Back?', $read['actions'][0]['presentation']['text'] );
		$this->assertIsArray( $this->rules()->validate( $this->rules()->saved()['rules'] ), 'and it validates as a Show' );
	}

	public function test_the_once_boolean_reads_as_a_frequency_and_the_next_save_keeps_the_revision(): void {
		$this->connect_site();
		$this->fake_http( static fn() => array( 200, array( 'ok' => true ) ) );
		$this->as_admin();
		$rule = $this->rule( array( 'rev' => 1 ) );
		unset( $rule['frequency'] );
		$rule['once'] = false;
		update_option(
			'wpsignal_rules',
			array(
				'version' => 1,
				'rules'   => array( $rule ),
				'removed' => array(),
			),
			false
		);
		$read = $this->rules()->saved()['rules'][0];
		$this->assertSame( 'always', $read['frequency'], 'once off was every time' );
		$this->assertArrayNotHasKey( 'once', $read );
		$this->assertSame( 'visitor', $this->rules()->validate( array( $this->rule( array( 'once' => true ) ) ) )[0]['frequency'], 'and once on was once per visitor' );
		$this->assertSame( 'visit', $this->rules()->validate( array( array_diff_key( $this->rule(), array( 'frequency' => 1 ) ) ) )[0]['frequency'], 'neither reads as once per visit' );
		$this->assertSame( 'page', $this->rules()->validate( array( $this->rule( array( 'frequency' => 'page' ) ) ) )[0]['frequency'], 'per page view is a frequency too' );

		list( $status, $data ) = $this->rest( 'POST', 'rules', array( 'rules' => array( $read ) ) );
		$this->assertSame( 200, $status, wp_json_encode( $data ) );
		$this->assertSame( 1, $data['rules'][0]['rev'], 'the migration is not an edit' );
		$this->assertSame( 'always', $data['rules'][0]['frequency'] );
	}

	public function test_the_client_config_carries_enabled_rules_and_the_fired_url_only_with_a_listener(): void {
		$this->connect_site();
		$this->fake_http( static fn() => array( 200, array( 'ok' => true ) ) );
		$clean = $this->rules()->validate(
			array(
				$this->rule(),
				$this->rule(
					array(
						'id'      => 'r2',
						'enabled' => false,
					)
				),
			)
		);
		$this->rules()->save( $clean );

		$config = $this->rules()->config();
		$this->assertSame( array( 'r1' ), array_column( $config['rules'], 'id' ) );
		$this->assertStringEndsWith( '/wpsignal/v1/prompt', $config['promptUrl'] );
		$this->assertArrayNotHasKey( 'recovery', $config, 'no site-wide taste: Show carries its own' );
		$show = array_column( $this->rules()->vocabulary()['actions'], null, 'key' )['show'];

		$this->assertArrayNotHasKey( 'firedUrl', $config, 'nobody listens, nothing is reported' );
		add_action( 'wpsignal_rule_fired', '__return_null' );
		try {
			$this->assertStringEndsWith( '/wpsignal/v1/fired', $this->rules()->config()['firedUrl'] );
		} finally {
			remove_action( 'wpsignal_rule_fired', '__return_null' );
		}
	}
}
