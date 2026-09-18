<?php
/**
 * Extension registry: plugins that build on WordSocket and show up on its settings page.
 *
 * @package WPSignal
 */

namespace WPSignal;

use WP_REST_Request;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Catalogue and registry for extensions.
 *
 * An extension is a separate plugin that depends on WordSocket. It registers
 * here on `wpsignal_loaded` so the Extensions tab can list it (even before its
 * own JavaScript loads, and with a "needs X" state when a requirement is
 * missing), enqueues its settings script on `wordsocket_settings_enqueue`, and
 * renders its panel through `window.wordsocket.ExtensionPanel`.
 *
 * @usage: register on `wpsignal_loaded`:
 * ```php
 *     WPS::instance()->extensions()->register(
 *         'shopsocket',
 *         array(
 *             'title'       => 'WooCommerce',
 *             'description' => 'Live orders board and live stock on product pages.',
 *             'version'     => '1.0.0',
 *             'docs_url'    => 'https://wpsignal.io/extensions/shopsocket',
 *             'requires'    => array( 'woocommerce/woocommerce.php' => 'WooCommerce' ),
 *         )
 *     );
 * ```
 */
class Extensions {

	/**
	 * Extensions WPSignal offers, shown with an install or "coming soon" state
	 * when they are not registered on this site.
	 *
	 * @var array<string, array{title: string, description: string, url: string, available: bool}>
	 */
	const CATALOGUE = array(
		'shopsocket'          => array(
			'title'       => 'ShopSocket',
			'description' => 'A live orders board for your team and live stock on product pages.',
			'url'         => 'https://wpsignal.io/extensions/shopsocket',
			'available'   => false,
		),
		'wordsocket-liveblog' => array(
			'title'       => 'PostSocket',
			'description' => 'Live coverage that updates in every reader\'s browser as you publish.',
			'url'         => 'https://wpsignal.io/extensions/postsocket',
			'available'   => false,
		),
		'wordsocket-chat'     => array(
			'title'       => 'ChatSocket',
			'description' => 'Realtime messaging between your site\'s users.',
			'url'         => 'https://wpsignal.io/extensions/chatsocket',
			'available'   => false,
		),
	);

	/**
	 * Registered extensions by slug.
	 *
	 * @var array<string, array>
	 */
	private array $registered = array();

	/**
	 * Register an extension installed on this site.
	 *
	 * @param string $slug Plugin slug, for example `shopsocket`.
	 * @param array  $args Extension metadata: `title`, `description`, `version`,
	 *                     `docs_url`, `file` (`plugin_basename( __FILE__ )`, which
	 *                     nests the plugin under WordSocket on the Plugins screen
	 *                     when its directory is not the slug), and `requires`
	 *                     (`plugin-dir/file.php => Label` pairs that must be active).
	 * @return void
	 */
	public function register( string $slug, array $args = array() ): void {
		$slug = sanitize_key( $slug );
		if ( '' === $slug ) {
			return;
		}
		$this->registered[ $slug ] = wp_parse_args(
			$args,
			array(
				'title'       => $slug,
				'description' => '',
				'version'     => '',
				'docs_url'    => '',
				'file'        => '',
				'requires'    => array(),
			)
		);
	}

	/**
	 * The plugin file of every extension WordSocket knows, registered or
	 * catalogued: what `Plugins_Screen` matches the Plugins list against.
	 *
	 * A registered extension names its own file; everything else is assumed to
	 * sit where WordPress.org installs it, in a directory named after its slug.
	 *
	 * @return array<string, string> Slug => plugin file.
	 */
	public function plugin_files(): array {
		$files = array();
		foreach ( array_keys( self::CATALOGUE ) as $slug ) {
			$files[ $slug ] = $slug . '/' . $slug . '.php';
		}
		foreach ( $this->registered as $slug => $ext ) {
			$file           = (string) ( $ext['file'] ?? '' );
			$files[ $slug ] = '' !== $file ? $file : ( $files[ $slug ] ?? $slug . '/' . $slug . '.php' );
		}
		return $files;
	}

	/**
	 * Registered extensions.
	 *
	 * @return array<string, array>
	 */
	public function registered(): array {
		return $this->registered;
	}

	/**
	 * Everything the Extensions tab shows: registered extensions first, then
	 * catalogue entries not installed here.
	 *
	 * @return array<int, array>
	 */
	public function all(): array {
		if ( ! function_exists( 'is_plugin_active' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$items = array();
		foreach ( $this->registered as $slug => $ext ) {
			$missing = array();
			foreach ( (array) $ext['requires'] as $plugin_file => $label ) {
				if ( ! is_plugin_active( $plugin_file ) ) {
					$missing[] = $label;
				}
			}
			$items[] = array(
				'slug'        => $slug,
				'title'       => $ext['title'],
				'description' => $ext['description'],
				'version'     => $ext['version'],
				'docs_url'    => $ext['docs_url'],
				'installed'   => true,
				'missing'     => $missing,
			);
		}
		foreach ( self::CATALOGUE as $slug => $entry ) {
			if ( isset( $this->registered[ $slug ] ) ) {
				continue;
			}
			$items[] = array(
				'slug'        => $slug,
				'title'       => $entry['title'],
				'description' => $entry['description'],
				'version'     => '',
				'docs_url'    => $entry['url'],
				'installed'   => false,
				'available'   => $entry['available'],
				'missing'     => array(),
			);
		}
		return $items;
	}

	/**
	 * `GET /wpsignal/v1/extensions`.
	 *
	 * @return void
	 */
	public function register_routes(): void {
		register_rest_route(
			'wpsignal/v1',
			'/extensions',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'handle_list' ),
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
	}

	/**
	 * REST handler.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public function handle_list( WP_REST_Request $request ) {
		unset( $request );
		return rest_ensure_response( array( 'extensions' => $this->all() ) );
	}
}
