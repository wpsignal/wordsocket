<?php
/**
 * Triggers: the builder API and the built-in post.updated trigger, end to end
 * through the publisher (HTTP intercepted).
 */

use WPSignal\WPS;

final class TriggersTest extends WordSocketTestCase {

	/** @var int[] Posts created by a test, deleted in tearDown. */
	private array $posts = array();

	protected function setUp(): void {
		parent::setUp();
		$this->connect_site();
		unset( $_SERVER['HTTPS'] ); // plain bodies, so events are readable
		$this->fake_http( static fn() => array( 200, array( 'ok' => true ) ) );
	}

	protected function tearDown(): void {
		foreach ( $this->posts as $id ) {
			wp_delete_post( $id, true );
		}
		$this->posts = array();
		parent::tearDown();
	}

	/** Every publish made so far, as subscribers see it (envelope opened). */
	private function published(): array {
		return array_map(
			fn( $r ) => $this->open_publish( $r['args']['body'] ),
			array_filter( $this->requests, static fn( $r ) => str_ends_with( $r['url'], '/publish' ) )
		);
	}

	public function test_custom_trigger_publishes_when_its_hook_fires_and_its_condition_passes(): void {
		$hook = 'wordsocket_test_' . uniqid();
		WPS::trigger( 'order.paid' )
			->on( $hook, 10, 2 )
			->channel( 'shop' )
			->data( static fn( $id, $total ) => array( 'order_id' => $id, 'total' => $total ) )
			->when( static fn( $id, $total ) => $total > 0 )
			->register();

		do_action( $hook, 7, 0 );
		$this->assertCount( 0, $this->published(), 'condition false: nothing published' );

		do_action( $hook, 8, 12.5 );
		$events = array_values( $this->published() );
		$this->assertCount( 1, $events );
		$this->assertSame( 'shop', $events[0]['channel'] );
		$this->assertSame( 'order.paid', $events[0]['event'] );
		$this->assertSame( array( 'order_id' => 8, 'total' => 12.5 ), $events[0]['data'] );

		$registered = array_map( static fn( $t ) => $t->get_event(), WPS::instance()->trigger_registry()->all() );
		$this->assertContains( 'order.paid', $registered );
	}

	public function test_publishing_a_post_fires_the_built_in_post_updated_trigger(): void {
		$id = wp_insert_post(
			array(
				'post_title'   => 'WordSocket test post',
				'post_content' => 'hello',
				'post_status'  => 'publish',
				'post_type'    => 'post',
			),
			true
		);
		$this->assertIsInt( $id );
		$this->posts[] = $id;

		$events = array_values( array_filter( $this->published(), static fn( $e ) => 'post.updated' === $e['event'] ) );
		$this->assertNotEmpty( $events, 'save_post on a published post publishes post.updated' );
		$data = end( $events )['data'];
		$this->assertSame( $id, $data['post_id'] );
		$this->assertSame( 'post', $data['post_type'] );
		$this->assertSame( 'WordSocket test post', $data['post_title'] );
		$this->assertSame( get_permalink( $id ), $data['permalink'] );
	}

	public function test_drafts_do_not_publish_post_updated(): void {
		$id = wp_insert_post(
			array(
				'post_title'  => 'WordSocket draft',
				'post_status' => 'draft',
				'post_type'   => 'post',
			),
			true
		);
		$this->posts[] = $id;

		$events = array_filter( $this->published(), static fn( $e ) => 'post.updated' === $e['event'] );
		$this->assertCount( 0, $events );
	}
}
