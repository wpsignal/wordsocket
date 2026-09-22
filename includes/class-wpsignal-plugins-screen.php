<?php
/**
 * Plugins screen: show WordSocket extensions as a family, under WordSocket.
 *
 * @package WordSocket
 */

namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Nests extension rows under WordSocket on the Plugins list table.
 *
 * WordPress has no nesting API for that screen: rows are sorted by the plugin
 * name (`WP_Plugins_List_Table::_order_callback()`), and the array it sorts is
 * the one the `all_plugins` filter hands back. So the only way to move a row
 * is to change the name it sorts by. Every extension row is renamed
 * "WordSocket: <name>", which sorts immediately after "WordSocket", and the
 * row is indented with a rule drawn in CSS (rows carry `data-plugin`).
 *
 * What counts as an extension: every slug registered through `Extensions`,
 * plus the `Extensions::CATALOGUE` slugs, so a row is still nested while its
 * plugin is deactivated and none of its code runs. Sites that would rather
 * keep the plain names filter `wordsocket_nested_plugin_rows` to an empty
 * array.
 */
class Plugins_Screen {

	/**
	 * Extension registry.
	 *
	 * @var Extensions
	 */
	private Extensions $extensions;

	/**
	 * Rows to nest: plugin file => slug. Null until first resolved.
	 *
	 * @var array<string, string>|null
	 */
	private ?array $rows = null;

	/**
	 * Constructor.
	 *
	 * @param Extensions $extensions Extension registry.
	 */
	public function __construct( Extensions $extensions ) {
		$this->extensions = $extensions;
	}

	/**
	 * Hook into the plugins screen.
	 *
	 * @return void
	 */
	public function init(): void {
		add_filter( 'all_plugins', array( $this, 'rename_rows' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_styles' ) );
	}

	/**
	 * Rename extension rows so they sort under WordSocket.
	 *
	 * @param array<string, array> $plugins Plugins the list table will show.
	 * @return array<string, array>
	 */
	public function rename_rows( $plugins ) {
		if ( ! is_array( $plugins ) ) {
			return $plugins;
		}

		$parent = $plugins[ self::plugin_file() ]['Name'] ?? '';
		if ( '' === $parent ) {
			return $plugins;
		}

		foreach ( $this->nested_rows( $plugins ) as $file => $slug ) {
			$name = $plugins[ $file ]['Name'] ?? '';
			if ( '' === $name || str_starts_with( $name, $parent ) ) {
				continue;
			}
			// Plain text only: the list table sorts the raw name, so markup would sort ahead of every row.
			$plugins[ $file ]['Name'] = sprintf(
				/* translators: 1: WordSocket, the parent plugin. 2: the extension's own name. */
				'%1$s: %2$s',
				$parent,
				$name
			);
		}

		return $plugins;
	}

	/**
	 * Indent the nested rows.
	 *
	 * @param string $hook_suffix Current admin screen.
	 * @return void
	 */
	public function enqueue_styles( $hook_suffix ): void {
		if ( 'plugins.php' !== $hook_suffix && 'plugins-network.php' !== $hook_suffix ) {
			return;
		}

		$selectors = array();
		foreach ( array_keys( $this->nested_rows() ) as $file ) {
			// Plugin files come from the filesystem: keep the selector to path characters.
			$file = preg_replace( '#[^A-Za-z0-9 ._/-]#', '', $file );
			if ( '' !== $file ) {
				$selectors[] = '.plugins tr[data-plugin="' . $file . '"] .plugin-title';
			}
		}

		if ( empty( $selectors ) ) {
			return;
		}

		$rule = implode( ",\n", $selectors );

		wp_add_inline_style(
			'list-tables',
			"@media screen and (min-width: 783px) {\n" .
			"{$rule} {\n\tposition: relative;\n\tpadding-left: 2.4em;\n}\n" .
			implode( ',', array_map( static fn( $s ) => $s . '::before', $selectors ) ) .
			" {\n\tcontent: \"\";\n\tposition: absolute;\n\tinset: 0 auto auto .8em;\n\twidth: 1em;\n\theight: 1.45em;\n" .
			"\tborder-left: 1px solid #a7aaad;\n\tborder-bottom: 1px solid #a7aaad;\n\tborder-bottom-left-radius: 4px;\n}\n}"
		);
	}

	/**
	 * Installed plugins that belong to the WordSocket family.
	 *
	 * A row is only renamed when its own plugin asked for it, one of two ways:
	 * it named its file when it registered here (`file` in `register()`), or
	 * its header declares `Requires Plugins: wordsocket`, which is WordPress's
	 * own dependency data and is what puts "Requires: WordSocket" on the row
	 * already. A slug alone is not enough: WordSocket has no business renaming
	 * a plugin that happens to sit in a directory this one recognises.
	 *
	 * @param array<string, array>|null $plugins Installed plugins to look through.
	 *                                           Defaults to `get_plugins()`.
	 * @return array<string, string> Plugin file => slug.
	 */
	private function nested_rows( ?array $plugins = null ): array {
		if ( null !== $this->rows ) {
			return $this->rows;
		}

		if ( null === $plugins ) {
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}
			$plugins = get_plugins();
		}

		$known    = $this->extensions->plugin_files();
		$ours     = self::plugin_file();
		$rows     = array();
		$declared = array();

		// Files an extension named itself. Everything else in `$known` is a guess.
		foreach ( $this->extensions->registered() as $slug => $ext ) {
			$file = (string) ( $ext['file'] ?? '' );
			if ( '' !== $file ) {
				$declared[ $file ] = $slug;
			}
		}

		foreach ( $plugins as $file => $data ) {
			if ( $file === $ours ) {
				continue;
			}
			$slug = $declared[ $file ] ?? '';
			if ( '' === $slug ) {
				$dir = dirname( $file );
				if ( isset( $known[ $dir ] ) && self::depends_on_us( $data ) ) {
					$slug = $dir;
				}
			}
			if ( '' !== $slug ) {
				$rows[ $file ] = $slug;
			}
		}

		/**
		 * Filters the extension rows nested under WordSocket on the Plugins screen.
		 *
		 * Return an empty array to leave every plugin where WordPress puts it.
		 *
		 * @param array<string, string> $rows Plugin file => extension slug.
		 */
		$this->rows = (array) apply_filters( 'wordsocket_nested_plugin_rows', $rows );

		return $this->rows;
	}

	/**
	 * Whether a plugin's header names WordSocket as a dependency
	 * (`Requires Plugins`, WordPress 6.5 and later).
	 *
	 * @param array $data Plugin data from `get_plugins()`.
	 * @return bool
	 */
	private static function depends_on_us( array $data ): bool {
		$requires = (string) ( $data['RequiresPlugins'] ?? '' );
		if ( '' === $requires ) {
			return false;
		}
		return in_array( dirname( self::plugin_file() ), array_map( 'trim', explode( ',', $requires ) ), true );
	}

	/**
	 * WordSocket's own plugin file, as the list table keys it.
	 *
	 * @return string
	 */
	private static function plugin_file(): string {
		return plugin_basename( DIR . 'wordsocket.php' );
	}
}
