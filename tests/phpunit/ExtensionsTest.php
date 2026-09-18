<?php
/**
 * Extension platform: channel reservations in minted tokens, the extension
 * registry, and its REST listing.
 */

use WPSignal\Channels;
use WPSignal\Extensions;
use WPSignal\Plugins_Screen;
use WPSignal\WPS;

final class ExtensionsTest extends WordSocketTestCase {

	private const SITE = 'abc';

	public function test_without_reservations_tokens_keep_the_site_wildcard(): void {
		$channels = new Channels();
		$this->assertFalse( $channels->is_strict() );
		$this->assertSame(
			array( 'site:abc:' ),
			$channels->allowed_prefixes( 0, self::SITE, array( 'site:abc:events', 'site:abc:livingposts' ) )
		);
		$this->assertSame( array( 'site:abc:' ), $channels->allowed_publish_prefixes( 0, self::SITE ), 'writing is the wildcard too' );
	}

	public function test_publish_grants_are_separate_from_subscribe_grants(): void {
		$channels = new Channels();
		$channels->reserve( 'woo:orders', 'manage_options' );
		$channels->reserve( 'woo:carts', 'manage_options', '__return_true' );
		$channels->reserve( 'woo:notes', 'manage_options', '__return_false' );

		// A visitor reads nothing reserved and writes only where a publish grant says so.
		$this->assertSame( array( 'site:abc:events' ), $channels->allowed_prefixes( 0, self::SITE, array() ) );
		$this->assertSame( array( 'site:abc:woo:carts:' ), $channels->allowed_publish_prefixes( 0, self::SITE ) );

		// An administrator reads all three; the publish grant defaults to the read
		// grant, and an explicit false keeps even them from writing.
		$this->as_admin();
		$admin = get_current_user_id();
		$this->assertSame(
			array( 'site:abc:events', 'site:abc:woo:orders:', 'site:abc:woo:carts:', 'site:abc:woo:notes:', 'site:abc:yjs:' ),
			$channels->allowed_prefixes( $admin, self::SITE, array() )
		);
		$this->assertSame( array( 'site:abc:woo:orders:', 'site:abc:woo:carts:', 'site:abc:yjs:' ), $channels->allowed_publish_prefixes( $admin, self::SITE ) );
	}

	public function test_strict_mode_keeps_the_collaboration_namespace_for_users_who_edit_posts(): void {
		$channels = new Channels();
		$channels->reserve( 'woo:orders', 'manage_options' );
		$this->assertSame( array( 'woo:orders:' ), array_keys( $channels->reservations() ), 'yjs is built in, not a reservation' );

		// Editors read and write the Yjs channels; visitors and subscribers get neither.
		$editor = self::factory_user( 'editor' );
		$this->assertContains( 'site:abc:yjs:', $channels->allowed_prefixes( $editor, self::SITE, array() ) );
		$this->assertSame( array( 'site:abc:yjs:' ), $channels->allowed_publish_prefixes( $editor, self::SITE ) );
		$this->assertNotContains( 'site:abc:yjs:', $channels->allowed_prefixes( 0, self::SITE, array() ) );
		$this->assertSame( array(), $channels->allowed_publish_prefixes( 0, self::SITE ) );
		$subscriber = self::factory_user( 'subscriber' );
		$this->assertNotContains( 'site:abc:yjs:', $channels->allowed_prefixes( $subscriber, self::SITE, array() ) );

		// A plugin reserving yjs itself takes over the grant.
		$channels->reserve( 'yjs', '__return_false' );
		$this->assertNotContains( 'site:abc:yjs:', $channels->allowed_prefixes( $editor, self::SITE, array() ) );
		$this->assertSame( array(), $channels->allowed_publish_prefixes( $editor, self::SITE ) );
	}

	public function test_a_reservation_switches_to_an_explicit_list_gated_by_capability(): void {
		$channels = new Channels();
		$channels->reserve( 'woo:orders', 'manage_options' );
		$channels->reserve( ':woo:customer:', static fn( $user_id ) => $user_id > 0 );
		$this->assertTrue( $channels->is_strict() );

		$registered = array( 'site:abc:events', 'livingposts' );

		// Visitor: public channels only, bare names get the site prefix.
		$this->assertSame(
			array( 'site:abc:events', 'site:abc:livingposts' ),
			$channels->allowed_prefixes( 0, self::SITE, $registered )
		);

		// Administrator: both reserved namespaces.
		$this->as_admin();
		$this->assertSame(
			array( 'site:abc:events', 'site:abc:livingposts', 'site:abc:woo:orders:', 'site:abc:woo:customer:', 'site:abc:yjs:' ),
			$channels->allowed_prefixes( get_current_user_id(), self::SITE, $registered )
		);

		// A subscriber: the callable grants, the capability does not.
		$subscriber = self::factory_user( 'subscriber' );
		$this->assertSame(
			array( 'site:abc:events', 'site:abc:livingposts', 'site:abc:woo:customer:' ),
			$channels->allowed_prefixes( $subscriber, self::SITE, $registered )
		);
		require_once ABSPATH . 'wp-admin/includes/user.php';
		wp_delete_user( $subscriber );
	}

	public function test_reserving_events_or_nothing_is_ignored(): void {
		$channels = new Channels();
		$channels->reserve( 'events', 'manage_options' );
		$channels->reserve( '', 'manage_options' );
		$this->assertFalse( $channels->is_strict() );
	}

	public function test_minted_tokens_carry_the_reserved_namespace_for_qualifying_users_only(): void {
		$this->connect_site( 'abc123' );
		$site_id = hash( 'sha256', 'site:abc123' );
		$live    = WPS::instance()->channels();
		$live->reserve( 'phpunit:private', 'manage_options' );
		try {
			$this->as_admin();
			list( , $payload ) = self::jwt_parts( WPS::instance()->token()->mint()['token'] );
			$this->assertContains( 'site:' . $site_id . ':phpunit:private:', $payload['allowed_channel_prefixes'] );
			$this->assertNotContains( 'site:' . $site_id . ':', $payload['allowed_channel_prefixes'], 'no wildcard once a namespace is reserved' );
			$this->assertSame( array( 'site:' . $site_id . ':phpunit:private:', 'site:' . $site_id . ':yjs:' ), $payload['allowed_publish_prefixes'], 'the publish grant follows the read grant; collaboration stays writable' );
			$this->assertContains( 'site:' . $site_id . ':yjs:', $payload['allowed_channel_prefixes'] );

			wp_set_current_user( 0 );
			list( , $payload ) = self::jwt_parts( WPS::instance()->token()->mint()['token'] );
			$this->assertSame( array( 'site:' . $site_id . ':events' ), $payload['allowed_channel_prefixes'] );
			$this->assertSame( array(), $payload['allowed_publish_prefixes'], 'a visitor writes nowhere in strict mode' );
		} finally {
			self::clear_reservations( $live );
		}
	}

	public function test_registry_lists_installed_extensions_before_the_catalogue(): void {
		$extensions = new Extensions();
		$extensions->register(
			'wordsocket-stub-extension',
			array(
				'title'    => 'Stub',
				'version'  => '1.0.0',
				'requires' => array( 'not-a-plugin/not-a-plugin.php' => 'Not A Plugin' ),
			)
		);
		$all = $extensions->all();

		$this->assertSame( 'wordsocket-stub-extension', $all[0]['slug'] );
		$this->assertTrue( $all[0]['installed'] );
		$this->assertSame( array( 'Not A Plugin' ), $all[0]['missing'] );

		$slugs = array_column( $all, 'slug' );
		foreach ( array_keys( Extensions::CATALOGUE ) as $slug ) {
			$this->assertContains( $slug, $slugs );
		}
		$catalogue_entry = $all[ array_search( 'shopsocket', $slugs, true ) ];
		$this->assertFalse( $catalogue_entry['installed'] );
		$this->assertArrayHasKey( 'available', $catalogue_entry );
	}

	public function test_plugin_files_prefer_a_registered_file_over_the_slug_directory(): void {
		$extensions = new Extensions();
		$extensions->register( 'shopsocket', array( 'file' => 'shopsocket-1.0/shopsocket.php' ) );
		$extensions->register( 'wordsocket-stub-extension', array() );
		$files = $extensions->plugin_files();

		$this->assertSame( 'shopsocket-1.0/shopsocket.php', $files['shopsocket'], 'a declared file wins over the catalogue guess' );
		$this->assertSame( 'wordsocket-stub-extension/wordsocket-stub-extension.php', $files['wordsocket-stub-extension'], 'a plugin that named no file sits in a directory named after its slug' );
		$this->assertSame( 'wordsocket-chat/wordsocket-chat.php', $files['wordsocket-chat'], 'catalogue slugs are known before they are installed' );
	}

	public function test_extension_rows_are_renamed_to_sort_under_wordsocket(): void {
		$extensions = new Extensions();
		$extensions->register(
			'shopsocket',
			array(
				'title' => 'ShopSocket',
				'file'  => 'shopsocket/shopsocket.php',
			)
		);
		$screen = new Plugins_Screen( $extensions );

		$ours = plugin_basename( \WPSignal\DIR . 'wordsocket.php' );
		$rows = $screen->rename_rows(
			array(
				$ours                                 => array( 'Name' => 'WordSocket' ),
				'shopsocket/shopsocket.php'           => array( 'Name' => 'ShopSocket' ),
				'wordsocket-chat/wordsocket-chat.php' => array(
					'Name'            => 'ChatSocket',
					'RequiresPlugins' => 'wordsocket',
				),
				'wordsocket-liveblog/wordsocket-liveblog.php' => array(
					'Name'            => 'WordSocket Live Blog',
					'RequiresPlugins' => 'woocommerce, wordsocket',
				),
				'woocommerce/woocommerce.php'         => array( 'Name' => 'WooCommerce' ),
			)
		);

		$this->assertSame( 'WordSocket', $rows[ $ours ]['Name'], 'the parent row keeps its name' );
		$this->assertSame( 'WordSocket: ShopSocket', $rows['shopsocket/shopsocket.php']['Name'] );
		$this->assertSame( 'WordSocket: ChatSocket', $rows['wordsocket-chat/wordsocket-chat.php']['Name'], 'a catalogued extension nests while it is inactive' );
		$this->assertSame( 'WordSocket Live Blog', $rows['wordsocket-liveblog/wordsocket-liveblog.php']['Name'], 'a name that already leads with WordSocket is left alone' );
		$this->assertSame( 'WooCommerce', $rows['woocommerce/woocommerce.php']['Name'], 'plugins outside the family are untouched' );

		// The point of the rename: the list table sorts these names with strcasecmp.
		$names = array_column( $rows, 'Name' );
		usort( $names, 'strcasecmp' );
		$this->assertSame(
			array( 'WooCommerce', 'WordSocket', 'WordSocket Live Blog', 'WordSocket: ChatSocket', 'WordSocket: ShopSocket' ),
			$names
		);
	}

	public function test_a_plugin_that_never_asked_is_left_alone(): void {
		$screen = new Plugins_Screen( new Extensions() );

		$ours = plugin_basename( \WPSignal\DIR . 'wordsocket.php' );
		$rows = $screen->rename_rows(
			array(
				$ours                                 => array( 'Name' => 'WordSocket' ),
				// A catalogued slug, but this plugin is somebody else's: no
				// registration, and its header names no dependency on us.
				'wordsocket-chat/wordsocket-chat.php' => array( 'Name' => 'Some Other Chat' ),
			)
		);

		$this->assertSame( 'Some Other Chat', $rows['wordsocket-chat/wordsocket-chat.php']['Name'] );
	}

	public function test_nesting_can_be_switched_off_with_a_filter(): void {
		$extensions = new Extensions();
		$extensions->register( 'shopsocket', array( 'file' => 'shopsocket/shopsocket.php' ) );
		$screen = new Plugins_Screen( $extensions );

		add_filter( 'wordsocket_nested_plugin_rows', '__return_empty_array' );
		try {
			$ours = plugin_basename( \WPSignal\DIR . 'wordsocket.php' );
			$rows = $screen->rename_rows(
				array(
					$ours                       => array( 'Name' => 'WordSocket' ),
					'shopsocket/shopsocket.php' => array( 'Name' => 'ShopSocket' ),
				)
			);
			$this->assertSame( 'ShopSocket', $rows['shopsocket/shopsocket.php']['Name'] );
		} finally {
			remove_filter( 'wordsocket_nested_plugin_rows', '__return_empty_array' );
		}
	}

	public function test_extensions_route_requires_manage_options(): void {
		wp_set_current_user( 0 );
		list( $status ) = $this->rest( 'GET', 'extensions' );
		$this->assertSame( 401, $status );

		$this->as_admin();
		list( $status, $data ) = $this->rest( 'GET', 'extensions' );
		$this->assertSame( 200, $status );
		$this->assertNotEmpty( $data['extensions'] );
	}

	private static function factory_user( string $role ): int {
		$id = wp_insert_user(
			array(
				'user_login' => 'wps-phpunit-' . wp_generate_password( 6, false ),
				'user_pass'  => wp_generate_password(),
				'role'       => $role,
			)
		);
		self::assertIsInt( $id );
		return $id;
	}

	/** The live registry is a singleton for the process: drop what a test reserved. */
	private static function clear_reservations( Channels $channels ): void {
		( new ReflectionProperty( $channels, 'reservations' ) )->setValue( $channels, array() );
	}
}
