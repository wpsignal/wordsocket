<?php
/**
 * WPSignal\Rules: the server half of the rules engine: the registry the builder offers, the saved rules validated
 * against it, the broadcast of enabled rules and the three routes. Stores no history and no firings.
 *
 * @package WordSocket
 */

namespace WPSignal;

use WP_Error, WP_REST_Request, WP_REST_Response;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The rules registry, store and routes.
 */
class Rules {

	const MAX_RULES      = 50;
	const MAX_CONDITIONS = 20;
	const MAX_ACTIONS    = 10;
	const MAX_TEXT       = 500;
	/** The longest an action may wait, in seconds. */
	const MAX_AFTER = 3600;
	/** The most a value kept for a condition or action nobody registered right now may weigh, as JSON. */
	const MAX_UNKNOWN_BYTES = 2000;
	/** How often a rule shows: on every transition, at most once per page view, once per visit (journey) or once per visitor. */
	const FREQUENCIES = array( 'always', 'page', 'visit', 'visitor' );

	const ID_PATTERN   = '/^[a-z0-9][a-z0-9_-]{0,63}$/i';
	const KEY_PATTERN  = '/^[a-z][a-z0-9_]{0,63}$/';
	const UUID_PATTERN = Presence::UUID_PATTERN;

	/**
	 * What a report to `/fired` is about: the firing, or what the visitor did with the prompt it showed.
	 *
	 * @since 0.31.0
	 */
	const FIRING_KINDS = array( 'fired', 'returned', 'dismissed', 'clicked' );

	/** Value types a condition or a param may declare. */
	const VALUE_TYPES = array( 'none', 'number', 'text', 'boolean', 'select', 'kind', 'id', 'hours', 'weekdays', 'presentation' );

	/**
	 * Registered conditions by key.
	 *
	 * @var array<string, array>
	 */
	private array $conditions = array();

	/**
	 * Registered actions by key.
	 *
	 * @var array<string, array>
	 */
	private array $actions = array();

	/**
	 * Registered contexts by key (descriptive: label and placeholders).
	 *
	 * @var array<string, array>
	 */
	private array $contexts = array();

	/**
	 * Configuration accessor.
	 *
	 * @var Config
	 */
	private Config $config;

	/**
	 * Event publisher, for `rules.updated`.
	 *
	 * @var Publisher
	 */
	private Publisher $publisher;

	/**
	 * Constructor.
	 *
	 * @param Config    $config    Configuration accessor.
	 * @param Publisher $publisher Event publisher.
	 */
	public function __construct( Config $config, Publisher $publisher ) {
		$this->config    = $config;
		$this->publisher = $publisher;
	}

	/**
	 * Describe a condition the builder may offer; the browser half is `WPS.rules.condition( key, test )`.
	 *
	 * @param string $key  `[a-z][a-z0-9_]*`.
	 * @param array  $args `label`, `description`, `operators` (list of `{ key, label }`), `value` (a VALUE_TYPES entry), `options` (`{ key: label }` for `select`), `source`.
	 * @return void
	 */
	public function condition( string $key, array $args ): void {
		if ( 1 !== preg_match( self::KEY_PATTERN, $key ) ) {
			return;
		}
		$this->conditions[ $key ] = $this->normalize_entry( $key, $args );
	}

	/**
	 * Describe an action the builder may offer; the browser half is `WPS.rules.action( key, run )`.
	 *
	 * @param string $key  `[a-z][a-z0-9_]*`.
	 * @param array  $args `label`, `description`, `params` (`{ key: { type, label, options, default } }`), `live`, `source`.
	 * @return void
	 */
	public function action( string $key, array $args ): void {
		if ( 1 !== preg_match( self::KEY_PATTERN, $key ) ) {
			return;
		}
		$params = array();
		foreach ( (array) ( $args['params'] ?? array() ) as $param_key => $param ) {
			$param_key = sanitize_key( (string) $param_key );
			if ( '' === $param_key ) {
				continue;
			}
			$params[ $param_key ] = $this->param_spec( $param_key, (array) $param );
		}

		/*
		 * Every action can wait: `after` is seconds from the moment the actions would run, counted
		 * by the engine, cancelled when the moment turns false or is taken back meanwhile.
		 */
		if ( ! isset( $params['after'] ) ) {
			$params['after'] = $this->param_spec(
				'after',
				array(
					'type'    => 'number',
					'label'   => __( 'Delay (seconds)', 'wordsocket' ),
					'default' => 0,
					'prefix'  => __( 'after', 'wordsocket' ),
					'suffix'  => __( 's', 'wordsocket' ),
				)
			);
		}
		$this->actions[ $key ] = array(
			'key'         => $key,
			'label'       => (string) ( $args['label'] ?? $key ),
			'description' => (string) ( $args['description'] ?? '' ),
			'params'      => $params,
			'live'        => (bool) ( $args['live'] ?? false ),
			'source'      => (string) ( $args['source'] ?? 'wordsocket' ),
		);
	}

	/**
	 * One param as the builder receives it: type, label, options, default, `when`, and the words before and after its control.
	 *
	 * @param string $param_key The param.
	 * @param array  $param     As registered.
	 * @return array
	 */
	private function param_spec( string $param_key, array $param ): array {
		$type = in_array( $param['type'] ?? '', self::VALUE_TYPES, true ) ? $param['type'] : 'text';
		return array(
			'type'    => $type,
			'label'   => (string) ( $param['label'] ?? $param_key ),
			'options' => (array) ( $param['options'] ?? array() ),
			'default' => $param['default'] ?? null,
			// The builder shows the param only while this boolean param of the same action is on.
			'when'    => sanitize_key( (string) ( $param['when'] ?? '' ) ),
			'prefix'  => (string) ( $param['prefix'] ?? '' ),
			'suffix'  => (string) ( $param['suffix'] ?? '' ),
		);
	}

	/**
	 * Describe a live context and the placeholders it offers, for the builder's hints.
	 *
	 * @param string $key  Context key.
	 * @param array  $args `label`, `placeholders` (`{ 'cart.total': label }`), `source`.
	 * @return void
	 */
	public function context( string $key, array $args ): void {
		if ( 1 !== preg_match( self::KEY_PATTERN, $key ) ) {
			return;
		}
		$this->contexts[ $key ] = array(
			'key'          => $key,
			'label'        => (string) ( $args['label'] ?? $key ),
			'placeholders' => (array) ( $args['placeholders'] ?? array() ),
			'source'       => (string) ( $args['source'] ?? 'wordsocket' ),
		);
	}

	/**
	 * A condition entry in its stored shape.
	 *
	 * @since 0.31.0 Takes `groups`.
	 *
	 * @param string $key  Key.
	 * @param array  $args As given.
	 * @return array
	 */
	private function normalize_entry( string $key, array $args ): array {
		$operators = array();
		foreach ( (array) ( $args['operators'] ?? array() ) as $op ) {
			$op_key = is_array( $op ) ? (string) ( $op['key'] ?? '' ) : (string) $op;
			if ( 1 === preg_match( self::KEY_PATTERN, $op_key ) ) {
				$operators[] = array(
					'key'   => $op_key,
					'label' => is_array( $op ) ? (string) ( $op['label'] ?? $op_key ) : $op_key,
				);
			}
		}
		// A select may group its options (`groups`: a list of `{ label, options }`); `options` stays the flat set the validator checks.
		$groups  = array();
		$options = (array) ( $args['options'] ?? array() );
		foreach ( (array) ( $args['groups'] ?? array() ) as $group ) {
			$members = (array) ( $group['options'] ?? array() );
			if ( empty( $members ) ) {
				continue;
			}
			$groups[] = array(
				'label'   => (string) ( $group['label'] ?? '' ),
				'options' => $members,
			);
			$options += $members;
		}
		return array(
			'key'         => $key,
			'label'       => (string) ( $args['label'] ?? $key ),
			'description' => (string) ( $args['description'] ?? '' ),
			'operators'   => $operators,
			'value'       => in_array( $args['value'] ?? '', self::VALUE_TYPES, true ) ? $args['value'] : 'none',
			'options'     => $options,
			'groups'      => $groups,
			'source'      => (string) ( $args['source'] ?? 'wordsocket' ),
		);
	}

	/**
	 * WordSocket's own vocabulary: the conditions and actions `src/rules/vocabulary.ts` implements.
	 *
	 * @return void
	 */
	public function register_defaults(): void {
		$is     = array(
			array(
				'key'   => 'is',
				'label' => __( 'is', 'wordsocket' ),
			),
			array(
				'key'   => 'is_not',
				'label' => __( 'is not', 'wordsocket' ),
			),
		);
		$bounds = array(
			array(
				'key'   => 'at_least',
				'label' => __( 'at least', 'wordsocket' ),
			),
			array(
				'key'   => 'at_most',
				'label' => __( 'at most', 'wordsocket' ),
			),
		);
		$this->condition(
			'page_kind',
			array(
				'label'     => __( 'Page', 'wordsocket' ),
				'operators' => $is,
				'value'     => 'select',
				'groups'    => $this->kind_groups(),
			)
		);
		$this->condition(
			'page_id',
			array(
				'label'     => __( 'Page id', 'wordsocket' ),
				'operators' => $is,
				'value'     => 'id',
			)
		);
		$this->condition(
			'term_id',
			array(
				'label'     => __( 'Term id', 'wordsocket' ),
				'operators' => $is,
				'value'     => 'id',
			)
		);
		$this->condition(
			'dwell',
			array(
				'label'       => __( 'Time on page while visible (seconds)', 'wordsocket' ),
				'operators'   => $bounds,
				'value'       => 'number',
				'description' => __( 'Stops counting while the tab is hidden.', 'wordsocket' ),
			)
		);
		$this->condition(
			'time_hidden',
			array(
				'label'       => __( 'Time on page while hidden (seconds)', 'wordsocket' ),
				'operators'   => $bounds,
				'value'       => 'number',
				'description' => __( 'Counts from the moment the tab is hidden and is 0 while it is visible.', 'wordsocket' ),
			)
		);
		$this->condition(
			'pages_viewed',
			array(
				'label'     => __( 'Pages so far', 'wordsocket' ),
				'operators' => $bounds,
				'value'     => 'number',
			)
		);
		$this->condition(
			'visited',
			array(
				'label'     => __( 'Earlier in the visit', 'wordsocket' ),
				'operators' => array(
					array(
						'key'   => 'includes',
						'label' => __( 'includes', 'wordsocket' ),
					),
					array(
						'key'   => 'excludes',
						'label' => __( 'excludes', 'wordsocket' ),
					),
				),
				'value'     => 'kind',
			)
		);
		$between = array(
			array(
				'key'   => 'between',
				'label' => __( 'between', 'wordsocket' ),
			),
		);
		$this->condition(
			'site_hour',
			array(
				'label'       => __( 'Time of day', 'wordsocket' ),
				'operators'   => $between,
				'value'       => 'hours',
				'description' => __( "The site's clock (Settings > General > Timezone).", 'wordsocket' ),
			)
		);
		$this->condition(
			'hour',
			array(
				'label'       => __( "Visitor's time of day", 'wordsocket' ),
				'operators'   => $between,
				'value'       => 'hours',
				'description' => __( "The visitor's own clock.", 'wordsocket' ),
			)
		);
		$this->condition(
			'weekday',
			array(
				'label'     => __( 'Day of the week', 'wordsocket' ),
				'operators' => array(
					array(
						'key'   => 'in',
						'label' => __( 'is one of', 'wordsocket' ),
					),
				),
				'value'     => 'weekdays',
			)
		);
		$this->condition(
			'visitor',
			array(
				'label'     => __( 'Visitor is', 'wordsocket' ),
				'operators' => array( $is[0] ),
				'value'     => 'select',
				'options'   => array(
					'new'       => __( 'new', 'wordsocket' ),
					'returning' => __( 'returning', 'wordsocket' ),
				),
			)
		);
		$this->condition(
			'logged_in',
			array(
				'label'     => __( 'Logged in', 'wordsocket' ),
				'operators' => array( $is[0] ),
				'value'     => 'boolean',
			)
		);
		$this->condition(
			'device',
			array(
				'label'       => __( 'Device', 'wordsocket' ),
				'description' => __( 'A guess from the pointer and the screen: a mouse or trackpad is a desktop; touch under 768 pixels wide is a phone, wider a tablet.', 'wordsocket' ),
				'operators'   => $is,
				'value'       => 'select',
				'options'     => array(
					'desktop' => __( 'desktop', 'wordsocket' ),
					'tablet'  => __( 'tablet', 'wordsocket' ),
					'mobile'  => __( 'mobile', 'wordsocket' ),
				),
			)
		);
		$this->context(
			'page',
			array(
				'label'        => __( 'Page', 'wordsocket' ),
				'placeholders' => array( 'page.title' => __( 'the page title', 'wordsocket' ) ),
			)
		);
		$this->context(
			'site',
			array(
				'label'        => __( 'Site', 'wordsocket' ),
				'placeholders' => array( 'site.name' => __( 'the site name', 'wordsocket' ) ),
			)
		);

		$presentation            = array(
			'type'    => 'presentation',
			'label'   => __( 'Show as', 'wordsocket' ),
			'options' => array(
				'modal'  => __( 'modal', 'wordsocket' ),
				'banner' => __( 'banner at the top', 'wordsocket' ),
				'bar'    => __( 'bar at the bottom', 'wordsocket' ),
				'toast'  => __( 'toast', 'wordsocket' ),
				'panel'  => __( 'slide-in panel', 'wordsocket' ),
			),
		);
		$presentation['default'] = array(
			'type'    => 'banner',
			'pattern' => 0,
			'text'    => '',
		);
		$this->action(
			'show',
			array(
				'label'       => __( 'Show', 'wordsocket' ),
				'description' => __( 'Shows the content to this visitor on this page.', 'wordsocket' ),
				'params'      => array( 'presentation' => $presentation ),
			)
		);
	}

	/**
	 * Everything registered, for the builder: WordSocket's own entries first, then extensions' in registration order.
	 *
	 * @return array{conditions: array, actions: array, contexts: array}
	 */
	public function vocabulary(): array {
		$own_first = static function ( array $entries ): array {
			$own    = array_filter( $entries, static fn( array $e ): bool => 'wordsocket' === $e['source'] );
			$others = array_filter( $entries, static fn( array $e ): bool => 'wordsocket' !== $e['source'] );
			return array_values( array_merge( $own, $others ) );
		};
		return array(
			'conditions' => $own_first( $this->conditions ),
			'actions'    => $own_first( $this->actions ),
			'contexts'   => $own_first( $this->contexts ),
		);
	}

	/**
	 * The page kinds a journey step may carry, as `key => label`.
	 *
	 * @since 0.31.0 Adds the post type archives.
	 *
	 * @return array<string, string>
	 */
	public function kinds(): array {
		$kinds = array(
			'home'    => __( 'Home page', 'wordsocket' ),
			'search'  => __( 'Search results', 'wordsocket' ),
			'archive' => __( 'Date or author archive', 'wordsocket' ),
			'other'   => __( 'Another page', 'wordsocket' ),
		);
		foreach ( get_post_types( array( 'public' => true ), 'objects' ) as $type ) {
			$kinds[ sanitize_key( $type->name ) ] = (string) $type->labels->singular_name;
		}
		foreach ( get_taxonomies( array( 'public' => true ), 'objects' ) as $taxonomy ) {
			$kinds[ sanitize_key( $taxonomy->name ) ] = (string) $taxonomy->labels->singular_name;
		}
		foreach ( $this->archive_kinds() as $key => $label ) {
			/* translators: %s: a post type's plural name */
			$kinds[ $key ] = sprintf( __( '%s archive', 'wordsocket' ), $label );
		}
		/**
		 * Filters the page kinds a rule may name (ShopSocket adds `shop`, `cart`, `checkout`, `thanks`, `category`).
		 *
		 * @param array<string, string> $kinds Kind key => label.
		 */
		$kinds = (array) apply_filters( 'wpsignal_page_kinds', $kinds );
		$clean = array();
		foreach ( $kinds as $key => $label ) {
			$key = sanitize_key( (string) $key );
			if ( '' !== $key ) {
				$clean[ $key ] = (string) $label;
			}
		}
		return $clean;
	}

	/**
	 * Every page kind under its heading, as the builder's selects list them: Pages, Archives, Taxonomies.
	 *
	 * @since 0.31.0
	 *
	 * @return array<int, array{label: string, options: array<string, string>}>
	 */
	public function kind_groups(): array {
		$kinds      = $this->kinds();
		$taxonomies = $this->taxonomy_kinds();
		$archives   = $this->archive_kinds();
		$pages      = array();
		$archived   = array();
		$terms      = array();
		// Post types lead (post first, as the builder's default), then the site's other pages, in `kinds()` order.
		foreach ( get_post_types( array( 'public' => true ), 'objects' ) as $type ) {
			$key = sanitize_key( $type->name );
			if ( isset( $kinds[ $key ] ) ) {
				$pages[ $key ] = $kinds[ $key ];
			}
		}
		foreach ( $kinds as $key => $label ) {
			if ( isset( $archives[ $key ] ) ) {
				$archived[ $key ] = $label;
			} elseif ( isset( $taxonomies[ $key ] ) ) {
				$terms[ $key ] = $label;
			} elseif ( ! isset( $pages[ $key ] ) && 'archive' !== $key ) {
				$pages[ $key ] = $label;
			}
		}
		if ( isset( $kinds['archive'] ) ) {
			$archived['archive'] = $kinds['archive'];
		}
		return array(
			array(
				'label'   => __( 'Pages', 'wordsocket' ),
				'options' => $pages,
			),
			array(
				'label'   => __( 'Archives', 'wordsocket' ),
				'options' => $archived,
			),
			array(
				'label'   => __( 'Taxonomies', 'wordsocket' ),
				'options' => $terms,
			),
		);
	}

	/**
	 * The page kinds that are taxonomy archives: every public taxonomy, plus what `wpsignal_taxonomy_kinds` adds.
	 *
	 * @return array<string, string> Kind key => label.
	 */
	public function taxonomy_kinds(): array {
		$taxonomies = array();
		foreach ( get_taxonomies( array( 'public' => true ), 'objects' ) as $taxonomy ) {
			$taxonomies[ sanitize_key( $taxonomy->name ) ] = (string) $taxonomy->labels->singular_name;
		}
		/**
		 * Filters the kinds that count as a taxonomy archive (ShopSocket adds `category`, its product category pages).
		 *
		 * @param array<string, string> $taxonomies Kind key => label.
		 */
		$taxonomies = (array) apply_filters( 'wpsignal_taxonomy_kinds', $taxonomies );
		$clean      = array();
		foreach ( $taxonomies as $key => $label ) {
			$key = sanitize_key( (string) $key );
			if ( '' !== $key ) {
				$clean[ $key ] = (string) $label;
			}
		}
		return $clean;
	}

	/**
	 * The page kinds that are post type archives (`<type>_archive`, labelled by the plural name), plus what `wpsignal_archive_kinds` changes.
	 *
	 * @since 0.31.0
	 *
	 * @return array<string, string> Kind key => label.
	 */
	public function archive_kinds(): array {
		$archives = array();
		// The blog index is the posts archive, but only when it is not the front page (`home`).
		if ( 'page' === get_option( 'show_on_front' ) && (int) get_option( 'page_for_posts' ) > 0 ) {
			$archives['post_archive'] = (string) get_post_type_object( 'post' )->labels->name;
		}
		foreach ( get_post_types( array( 'public' => true ), 'objects' ) as $type ) {
			if ( ! empty( $type->has_archive ) ) {
				$archives[ sanitize_key( $type->name ) . '_archive' ] = (string) $type->labels->name;
			}
		}
		/**
		 * Filters the kinds that are post type archives (ShopSocket drops `product_archive`, since the shop page is its `shop` kind).
		 *
		 * @param array<string, string> $archives Kind key => label.
		 */
		$archives = (array) apply_filters( 'wpsignal_archive_kinds', $archives );
		$clean    = array();
		foreach ( $archives as $key => $label ) {
			$key = sanitize_key( (string) $key );
			if ( '' !== $key ) {
				$clean[ $key ] = (string) $label;
			}
		}
		return $clean;
	}

	/**
	 * A condition tree with every condition keyed `$from` re-keyed `$to`.
	 *
	 * @since 0.31.0
	 *
	 * @param array  $node A group or a condition.
	 * @param string $from The key to replace.
	 * @param string $to   Its replacement.
	 * @return array
	 */
	private static function rekey_conditions( array $node, string $from, string $to ): array {
		foreach ( array( 'all', 'any' ) as $list ) {
			if ( isset( $node[ $list ] ) && is_array( $node[ $list ] ) ) {
				$node[ $list ] = array_map( static fn( $child ) => is_array( $child ) ? self::rekey_conditions( $child, $from, $to ) : $child, $node[ $list ] );
			}
		}
		$key = $node['condition'] ?? null;
		if ( $from === $key ) {
			$node['condition'] = $to;
		}
		return $node;
	}

	/**
	 * The saved option, in shape.
	 *
	 * @since 0.31.0 Re-keys the `taxonomy` and `archive` conditions to `page_kind`.
	 *
	 * @return array{version: int, rules: array, removed: string[]}
	 */
	public function saved(): array {
		$saved = $this->config->rules();
		// Older shapes read as the current one: a `params` wrapper, `content` plus a presentation key, the
		// `dynamic` action, and the attention switch on the action or as three flat fields on the rule.
		foreach ( $saved['rules'] as &$rule ) {
			$attention = (array) ( $rule['attention'] ?? array() );
			if ( ! empty( $rule['grab_attention'] ) ) {
				$attention['enabled'] = true;
			}
			if ( empty( $attention['title'] ) && ! empty( $rule['attention_title'] ) ) {
				$attention['title'] = (string) $rule['attention_title'];
			}
			// Older shapes: the flash delay and the flat attention fields are dropped.
			unset( $rule['grab_attention'], $rule['attention_title'], $rule['attention_delay'] );
			// A boolean `once` reads as a frequency.
			$rule['frequency'] = $this->frequency_of( $rule );
			unset( $rule['once'] );
			// The `taxonomy` and `archive` conditions read as `page_kind`.
			if ( is_array( $rule['conditions'] ?? null ) ) {
				$rule['conditions'] = self::rekey_conditions( self::rekey_conditions( $rule['conditions'], 'taxonomy', 'page_kind' ), 'archive', 'page_kind' );
			}
			foreach ( (array) ( $rule['actions'] ?? array() ) as $i => $action ) {
				$action = (array) $action;
				$params = (array) $action + (array) ( $action['params'] ?? array() );
				unset( $params['action'], $params['params'] );
				$key = (string) ( $action['action'] ?? '' );
				if ( 'dynamic' === $key || ! empty( $params['grab_attention'] ) ) {
					$attention['enabled'] = true;
					if ( empty( $attention['title'] ) && ! empty( $params['title'] ) ) {
						$attention['title'] = (string) $params['title'];
					}
					$key = 'show';
				}
				unset( $params['grab_attention'], $params['title'], $params['unfocused_delay'], $params['badge'], $params['sound'] );
				if ( 'show' === $key && isset( $params['content'] ) ) {
					$content                = (array) $params['content'];
					$params['presentation'] = array(
						'type'    => is_string( $params['presentation'] ?? null ) ? $params['presentation'] : 'banner',
						'pattern' => (int) ( $content['pattern'] ?? 0 ),
						'text'    => (string) ( $content['text'] ?? '' ),
					);
					unset( $params['content'] );
				}
				// `after` defaults to 0.
				$params['after']       = (int) ( $params['after'] ?? 0 );
				$rule['actions'][ $i ] = array( 'action' => $key ) + $params;
			}
			$rule['attention'] = array(
				'enabled' => (bool) ( $attention['enabled'] ?? false ),
				'title'   => (string) ( $attention['title'] ?? '' ),
			);
		}
		unset( $rule );
		return $saved;
	}

	/**
	 * Rules shipped by extensions through `wpsignal_default_rules`, normalized, disabled.
	 *
	 * @return array<string, array> By id.
	 */
	private function defaults(): array {
		/**
		 * Filters the rules extensions ship. Each is a full rule; it appears disabled until saved, and a removed id stays removed.
		 *
		 * @param array $rules Rules.
		 */
		$shipped = (array) apply_filters( 'wpsignal_default_rules', array() );
		$out     = array();
		foreach ( $shipped as $rule ) {
			if ( ! is_array( $rule ) || ! is_string( $rule['id'] ?? null ) || 1 !== preg_match( self::ID_PATTERN, $rule['id'] ) ) {
				continue;
			}
			$rule['enabled']   = false;
			$rule['rev']       = 0;
			$rule['frequency'] = $this->frequency_of( $rule );
			unset( $rule['once'] );
			$out[ $rule['id'] ] = $rule;
		}
		return $out;
	}

	/**
	 * Saved rules plus unsaved defaults, each flagged `unavailable` when it names a key nobody registered.
	 *
	 * @return array
	 */
	public function all(): array {
		$saved   = $this->saved();
		$by_id   = array();
		$removed = array_flip( $saved['removed'] );
		foreach ( $saved['rules'] as $rule ) {
			$by_id[ $rule['id'] ] = $rule;
		}
		foreach ( $this->defaults() as $id => $rule ) {
			if ( ! isset( $by_id[ $id ] ) && ! isset( $removed[ $id ] ) ) {
				$by_id[ $id ] = $rule;
			}
		}
		return array_values(
			array_map(
				function ( array $rule ): array {
					$rule['unavailable'] = array_values( $this->unknown_keys( $rule ) );
					return $rule;
				},
				$by_id
			)
		);
	}

	/**
	 * Enabled saved rules: what browsers receive.
	 *
	 * @return array
	 */
	public function enabled(): array {
		return array_values( array_filter( $this->saved()['rules'], static fn( array $rule ): bool => ! empty( $rule['enabled'] ) ) );
	}

	/**
	 * Condition and action keys of a rule that nothing registered (a deactivated extension's).
	 *
	 * @param array $rule The rule.
	 * @return string[]
	 */
	private function unknown_keys( array $rule ): array {
		$unknown = array();
		$walk    = function ( $node ) use ( &$walk, &$unknown ): void {
			if ( ! is_array( $node ) ) {
				return;
			}
			if ( isset( $node['all'] ) || isset( $node['any'] ) ) {
				foreach ( (array) ( $node['all'] ?? $node['any'] ) as $child ) {
					$walk( $child );
				}
				return;
			}
			$key = (string) ( $node['condition'] ?? '' );
			if ( '' !== $key && ! isset( $this->conditions[ $key ] ) ) {
				$unknown[ $key ] = $key;
			}
		};
		$walk( $rule['conditions'] ?? array() );
		foreach ( (array) ( $rule['actions'] ?? array() ) as $action ) {
			$key = (string) ( $action['action'] ?? '' );
			if ( '' !== $key && ! isset( $this->actions[ $key ] ) ) {
				$unknown[ $key ] = $key;
			}
		}
		return $unknown;
	}

	/**
	 * Check and normalize rules against the registry. Unknown keys pass only
	 * when the saved copy of the same rule already had them, so a deactivated
	 * extension's rule survives a save of the others.
	 *
	 * @param array $rules As posted.
	 * @return array|WP_Error Normalized rules, or `wpsignal_invalid_rules` naming the rule and field.
	 */
	public function validate( array $rules ) {
		if ( count( $rules ) > self::MAX_RULES ) {
			return $this->invalid( '', 'rules', __( 'Too many moments.', 'wordsocket' ) );
		}
		$saved_by_id = array();
		foreach ( $this->saved()['rules'] as $rule ) {
			$saved_by_id[ $rule['id'] ] = $rule;
		}
		$clean = array();
		$seen  = array();
		foreach ( $rules as $rule ) {
			if ( ! is_array( $rule ) ) {
				return $this->invalid( '', 'rule', __( 'A moment must be an object.', 'wordsocket' ) );
			}
			$id = (string) ( $rule['id'] ?? '' );
			if ( 1 !== preg_match( self::ID_PATTERN, $id ) || isset( $seen[ $id ] ) ) {
				return $this->invalid( $id, 'id', __( 'Each moment needs a unique id.', 'wordsocket' ) );
			}
			$seen[ $id ] = true;
			$name        = sanitize_text_field( (string) ( $rule['name'] ?? '' ) );
			if ( '' === $name || mb_strlen( $name ) > 120 ) {
				return $this->invalid( $id, 'name', __( 'A moment needs a name of up to 120 characters.', 'wordsocket' ) );
			}
			$known_before = isset( $saved_by_id[ $id ] ) ? $this->unknown_keys( $saved_by_id[ $id ] ) : array();
			$budget       = self::MAX_CONDITIONS;
			$conditions   = $this->validate_group( $rule['conditions'] ?? null, $id, $known_before, $budget );
			if ( is_wp_error( $conditions ) ) {
				return $conditions;
			}
			$actions = $this->validate_actions( $rule['actions'] ?? null, $id, $known_before );
			if ( is_wp_error( $actions ) ) {
				return $actions;
			}
			$entry = array(
				'id'         => $id,
				'name'       => $name,
				'enabled'    => (bool) ( $rule['enabled'] ?? false ),
				'frequency'  => $this->frequency_of( $rule ),
				'rev'        => 0,
				'conditions' => $conditions,
				'actions'    => $actions,
			);
			if ( isset( $rule['frequency'] ) && ! in_array( $rule['frequency'], self::FREQUENCIES, true ) ) {
				return $this->invalid( $id, 'frequency', __( 'A moment shows repeatedly, per page view, once per visit or once per visitor.', 'wordsocket' ) );
			}
			$attention          = (array) ( $rule['attention'] ?? array() );
			$entry['attention'] = array(
				'enabled' => (bool) ( $attention['enabled'] ?? false ),
				'title'   => mb_substr( sanitize_text_field( (string) ( $attention['title'] ?? '' ) ), 0, 80 ),
			);
			if ( ! empty( $rule['source'] ) ) {
				$entry['source'] = sanitize_key( (string) $rule['source'] );
			}
			$clean[] = $entry;
		}
		return $clean;
	}

	/**
	 * How often a rule shows, from its `frequency` or the older `once` boolean; once per visit when it says neither.
	 *
	 * @param array $rule Rule.
	 * @return string One of FREQUENCIES.
	 */
	private function frequency_of( array $rule ): string {
		if ( isset( $rule['frequency'] ) && in_array( $rule['frequency'], self::FREQUENCIES, true ) ) {
			return (string) $rule['frequency'];
		}
		if ( isset( $rule['once'] ) ) {
			return $rule['once'] ? 'visitor' : 'always';
		}
		return 'visit';
	}

	/**
	 * A `wpsignal_invalid_rules` error.
	 *
	 * @param string $rule_id Rule id, '' when none.
	 * @param string $field   The field at fault.
	 * @param string $message What is wrong.
	 * @return WP_Error
	 */
	private function invalid( string $rule_id, string $field, string $message ): WP_Error {
		return new WP_Error(
			'wpsignal_invalid_rules',
			$message,
			array(
				'status' => 400,
				'rule'   => $rule_id,
				'field'  => $field,
			)
		);
	}

	/**
	 * Validate a condition group.
	 *
	 * @param mixed    $group        `{ all: [...] }` or `{ any: [...] }`.
	 * @param string   $rule_id      For errors.
	 * @param string[] $known_before Unknown keys the saved copy already had.
	 * @param int      $budget       Conditions left.
	 * @return array|WP_Error
	 */
	private function validate_group( $group, string $rule_id, array $known_before, int &$budget ) {
		if ( ! is_array( $group ) || ( ! isset( $group['all'] ) && ! isset( $group['any'] ) ) ) {
			return $this->invalid( $rule_id, 'conditions', __( 'Conditions must be an all or any group.', 'wordsocket' ) );
		}
		$mode = isset( $group['all'] ) ? 'all' : 'any';
		if ( ! is_array( $group[ $mode ] ) || array() === $group[ $mode ] ) {
			return $this->invalid( $rule_id, 'conditions', __( 'A group needs at least one condition.', 'wordsocket' ) );
		}
		$clean = array();
		foreach ( (array) $group[ $mode ] as $node ) {
			if ( is_array( $node ) && ( isset( $node['all'] ) || isset( $node['any'] ) ) ) {
				$child = $this->validate_group( $node, $rule_id, $known_before, $budget );
				if ( is_wp_error( $child ) ) {
					return $child;
				}
				$clean[] = $child;
				continue;
			}
			--$budget;
			if ( $budget < 0 ) {
				return $this->invalid( $rule_id, 'conditions', __( 'Too many conditions in one moment.', 'wordsocket' ) );
			}
			$condition = $this->validate_condition( $node, $rule_id, $known_before );
			if ( is_wp_error( $condition ) ) {
				return $condition;
			}
			$clean[] = $condition;
		}
		return array( $mode => $clean );
	}

	/**
	 * Validate one condition against its registration.
	 *
	 * @param mixed    $node         `{ condition, op, value }`.
	 * @param string   $rule_id      For errors.
	 * @param string[] $known_before Unknown keys the saved copy already had.
	 * @return array|WP_Error
	 */
	private function validate_condition( $node, string $rule_id, array $known_before ) {
		$key = is_array( $node ) ? (string) ( $node['condition'] ?? '' ) : '';
		$op  = is_array( $node ) ? (string) ( $node['op'] ?? '' ) : '';
		if ( 1 !== preg_match( self::KEY_PATTERN, $key ) || 1 !== preg_match( self::KEY_PATTERN, $op ) ) {
			return $this->invalid( $rule_id, 'condition', __( 'A condition needs a key and an operator.', 'wordsocket' ) );
		}
		if ( ! isset( $this->conditions[ $key ] ) ) {
			if ( isset( $known_before[ $key ] ) ) {
				if ( ! $this->small( $node['value'] ?? null ) ) {
					return $this->invalid( $rule_id, 'value', __( 'The value is too large to keep.', 'wordsocket' ) );
				}
				return array(
					'condition' => $key,
					'op'        => $op,
					'value'     => $node['value'] ?? null,
				);
			}
			/* translators: %s: condition key */
			return $this->invalid( $rule_id, 'condition', sprintf( __( 'Unknown condition "%s".', 'wordsocket' ), $key ) );
		}
		$spec = $this->conditions[ $key ];
		if ( ! in_array( $op, array_column( $spec['operators'], 'key' ), true ) ) {
			/* translators: 1: operator, 2: condition key */
			return $this->invalid( $rule_id, 'op', sprintf( __( 'Operator "%1$s" does not apply to "%2$s".', 'wordsocket' ), $op, $key ) );
		}
		$value = $this->validate_value( $spec['value'], $node['value'] ?? null, $spec['options'] );
		if ( is_wp_error( $value ) ) {
			return $this->invalid( $rule_id, 'value', $value->get_error_message() );
		}
		return array(
			'condition' => $key,
			'op'        => $op,
			'value'     => $value,
		);
	}

	/**
	 * Validate the actions of a rule.
	 *
	 * @param mixed    $actions      List of `{ action, params }`.
	 * @param string   $rule_id      For errors.
	 * @param string[] $known_before Unknown keys the saved copy already had.
	 * @return array|WP_Error
	 */
	private function validate_actions( $actions, string $rule_id, array $known_before ) {
		if ( ! is_array( $actions ) || 0 === count( $actions ) || count( $actions ) > self::MAX_ACTIONS ) {
			return $this->invalid( $rule_id, 'actions', __( 'A moment needs between one and ten actions.', 'wordsocket' ) );
		}
		$clean = array();
		foreach ( $actions as $action ) {
			$key = is_array( $action ) ? (string) ( $action['action'] ?? '' ) : '';
			if ( 1 !== preg_match( self::KEY_PATTERN, $key ) ) {
				return $this->invalid( $rule_id, 'action', __( 'An action needs a key.', 'wordsocket' ) );
			}
			// An action is `{ action, ...params }`; an older `params` wrapper is folded in.
			$given = (array) $action + (array) ( $action['params'] ?? array() );
			unset( $given['action'], $given['params'] );
			if ( ! isset( $this->actions[ $key ] ) ) {
				if ( isset( $known_before[ $key ] ) ) {
					if ( ! $this->small( $given ) ) {
						return $this->invalid( $rule_id, 'action', __( 'The action is too large to keep.', 'wordsocket' ) );
					}
					$clean[] = array( 'action' => $key ) + $given;
					continue;
				}
				/* translators: %s: action key */
				return $this->invalid( $rule_id, 'action', sprintf( __( 'Unknown action "%s".', 'wordsocket' ), $key ) );
			}
			$params = array();
			foreach ( $this->actions[ $key ]['params'] as $param_key => $param ) {
				$value = $this->validate_value( $param['type'], $given[ $param_key ] ?? $param['default'], $param['options'] );
				if ( is_wp_error( $value ) ) {
					return $this->invalid( $rule_id, $param_key, $value->get_error_message() );
				}
				if ( 'after' === $param_key ) {
					$value = min( self::MAX_AFTER, max( 0, (int) $value ) );
				}
				$params[ $param_key ] = $value;
			}
			$clean[] = array( 'action' => $key ) + $params;
		}
		return $clean;
	}

	/**
	 * Whether a value kept unvalidated (its condition or action is not registered right now) is small enough to store and broadcast.
	 *
	 * @param mixed $value As given.
	 * @return bool
	 */
	private function small( $value ): bool {
		return strlen( (string) wp_json_encode( $value ) ) <= self::MAX_UNKNOWN_BYTES;
	}

	/**
	 * Validate one value by its declared type.
	 *
	 * @param string $type    A VALUE_TYPES entry.
	 * @param mixed  $value   As given.
	 * @param array  $options For `select`.
	 * @return mixed|WP_Error The normalized value.
	 */
	private function validate_value( string $type, $value, array $options ) {
		switch ( $type ) {
			case 'none':
				return null;
			case 'number':
				return is_numeric( $value ) ? (float) $value + 0 : new WP_Error( 'value', __( 'A number is needed.', 'wordsocket' ) );
			case 'id':
				return is_numeric( $value ) && (int) $value > 0 ? (int) $value : new WP_Error( 'value', __( 'An id is needed.', 'wordsocket' ) );
			case 'text':
				return mb_substr( sanitize_text_field( (string) ( is_scalar( $value ) ? $value : '' ) ), 0, self::MAX_TEXT );
			case 'boolean':
				return (bool) $value;
			case 'select':
				$value = (string) ( is_scalar( $value ) ? $value : '' );
				return isset( $options[ $value ] ) ? $value : new WP_Error( 'value', __( 'Not one of the choices.', 'wordsocket' ) );
			case 'kind':
				$value = sanitize_key( (string) ( is_scalar( $value ) ? $value : '' ) );
				return isset( $this->kinds()[ $value ] ) ? $value : new WP_Error( 'value', __( 'Not a page kind on this site.', 'wordsocket' ) );
			case 'presentation':
				$given   = is_array( $value ) ? $value : array( 'type' => $value );
				$type    = $given['type'] ?? '';
				$text    = $given['text'] ?? '';
				$type    = sanitize_key( is_scalar( $type ) ? (string) $type : '' );
				$pattern = (int) ( $given['pattern'] ?? 0 );
				if ( $pattern > 0 && ! self::is_pattern( $pattern ) ) {
					return new WP_Error( 'value', __( 'The pattern is not a published synced pattern.', 'wordsocket' ) );
				}
				return array(
					'type'    => '' === $type || ( ! empty( $options ) && ! isset( $options[ $type ] ) ) ? 'banner' : $type,
					'pattern' => max( 0, $pattern ),
					'text'    => mb_substr( sanitize_textarea_field( is_scalar( $text ) ? (string) $text : '' ), 0, self::MAX_TEXT ),
				);
			case 'hours':
				$from = is_array( $value ) ? (int) ( $value['from'] ?? -1 ) : -1;
				$to   = is_array( $value ) ? (int) ( $value['to'] ?? -1 ) : -1;
				if ( $from < 0 || $from > 23 || $to < 0 || $to > 23 ) {
					return new WP_Error( 'value', __( 'Hours run from 0 to 23.', 'wordsocket' ) );
				}
				return array(
					'from' => $from,
					'to'   => $to,
				);
			case 'weekdays':
				$days = array_values( array_unique( array_filter( array_map( 'intval', (array) $value ), static fn( int $d ): bool => $d >= 0 && $d <= 6 ) ) );
				return empty( $days ) ? new WP_Error( 'value', __( 'Pick at least one day.', 'wordsocket' ) ) : $days;
		}
		return null;
	}

	/**
	 * Whether an id is a published synced pattern (`wp_block`).
	 *
	 * @param int $id Post id.
	 * @return bool
	 */
	public static function is_pattern( int $id ): bool {
		$post = get_post( $id );
		return $post instanceof \WP_Post && 'wp_block' === $post->post_type && 'publish' === $post->post_status;
	}

	/**
	 * Pattern ids an enabled rule names: what the prompt route serves, so a pattern is public from the moment a live rule shows it.
	 *
	 * @return int[]
	 */
	public function referenced_patterns(): array {
		$ids = array();
		foreach ( $this->enabled() as $rule ) {
			foreach ( (array) ( $rule['actions'] ?? array() ) as $action ) {
				$presentation = $action['presentation'] ?? null;
				$pattern      = is_array( $presentation ) ? (int) ( $presentation['pattern'] ?? 0 ) : 0;
				if ( $pattern > 0 ) {
					$ids[ $pattern ] = $pattern;
				}
			}
		}
		return array_values( $ids );
	}

	/**
	 * Save the rules, bump versions, and tell every open browser.
	 *
	 * @param array $rules Validated rules.
	 * @return array{version: int, rules: array, removed: string[]}
	 */
	public function save( array $rules ): array {
		$saved  = $this->saved();
		$before = array();
		foreach ( $saved['rules'] as $rule ) {
			$before[ $rule['id'] ] = $rule;
		}
		$removed = array_flip( $saved['removed'] );
		foreach ( $rules as &$rule ) {
			$old         = $before[ $rule['id'] ] ?? null;
			$same        = $old && $this->fingerprint( $old ) === $this->fingerprint( $rule );
			$rule['rev'] = $same ? (int) $old['rev'] : (int) ( $old['rev'] ?? 0 ) + 1;
			unset( $removed[ $rule['id'] ] );
		}
		unset( $rule );
		// A shipped default left out of a save was deleted on purpose: it stays gone until posted again.
		$posted = array_flip( array_column( $rules, 'id' ) );
		foreach ( array_keys( $this->defaults() ) as $id ) {
			if ( ! isset( $posted[ $id ] ) ) {
				$removed[ $id ] = true;
			}
		}
		$saved['rules']   = array_values( $rules );
		$saved['removed'] = array_values( array_map( 'strval', array_keys( $removed ) ) );
		$saved['version'] = (int) $saved['version'] + 1;
		$this->config->save_rules( $saved );
		$this->publisher->publish( 'events', 'rules.updated', $this->broadcast() );
		return $saved;
	}

	/**
	 * A synced pattern was saved, trashed or deleted: when an enabled rule shows it, the version moves so every browser fetches its markup again, with no rule re-armed.
	 *
	 * @param int           $post_id The post.
	 * @param \WP_Post|null $post    The post, when the hook passes it.
	 * @return void
	 */
	public function on_pattern_changed( int $post_id, $post = null ): void {
		$post = $post instanceof \WP_Post ? $post : get_post( $post_id );
		if ( ! $post instanceof \WP_Post || 'wp_block' !== $post->post_type || wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
			return;
		}
		if ( ! in_array( (int) $post_id, $this->referenced_patterns(), true ) ) {
			return;
		}
		$saved            = $this->saved();
		$saved['version'] = (int) $saved['version'] + 1;
		$this->config->save_rules( $saved );
		$this->publisher->publish( 'events', 'rules.updated', $this->broadcast() );
	}

	/**
	 * A rule without its revision, for change detection.
	 *
	 * @param array $rule The rule.
	 * @return string
	 */
	private function fingerprint( array $rule ): string {
		// Not `enabled`: a pause and a resume keep the revision, so visitors who saw a once-only moment do not see it again.
		unset( $rule['rev'], $rule['unavailable'], $rule['enabled'] );
		return (string) wp_json_encode( $this->canonical( $rule ) );
	}

	/**
	 * The array with its keys sorted at every depth, so a field `saved()` adds on read compares equal wherever it sits.
	 *
	 * @param array $value Array.
	 * @return array
	 */
	private function canonical( array $value ): array {
		foreach ( $value as &$item ) {
			if ( is_array( $item ) ) {
				$item = $this->canonical( $item );
			}
		}
		unset( $item );
		if ( ! array_is_list( $value ) ) {
			ksort( $value );
		}
		return $value;
	}

	/**
	 * What browsers receive: the version and the enabled rules.
	 *
	 * @return array{version: int, rules: array}
	 */
	public function broadcast(): array {
		return array(
			'version' => (int) $this->saved()['version'],
			'rules'   => $this->enabled(),
		);
	}

	/**
	 * The client's `wpSignalConfig.rules`.
	 *
	 * @since 0.31.0 Prints `firedUrl` while History is on as well as while something listens.
	 *
	 * @return array
	 */
	public function config(): array {
		$config               = $this->broadcast();
		$config['promptUrl']  = rest_url( 'wpsignal/v1/prompt' );
		$config['liveUrl']    = rest_url( 'wpsignal/v1/rules/live' );
		$config['taxonomies'] = array_keys( $this->taxonomy_kinds() );
		$config['timezone']   = wp_timezone_string();
		if ( WPS::journeys()->enabled() || has_action( 'wpsignal_rule_fired' ) ) {
			$config['firedUrl'] = rest_url( 'wpsignal/v1/fired' );
		}
		return $config;
	}

	/**
	 * Register the routes. Hooked to `rest_api_init` during WPS::boot().
	 *
	 * @since 0.31.0 The fired route takes `ms` and `kind`.
	 *
	 * @return void
	 */
	public function register_routes(): void {
		$staff = static fn() => current_user_can( 'manage_options' );
		register_rest_route(
			'wpsignal/v1',
			'/rules',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'handle_get' ),
					'permission_callback' => $staff,
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'handle_post' ),
					'permission_callback' => $staff,
				),
			)
		);
		register_rest_route(
			'wpsignal/v1',
			'/rules/live',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'handle_live' ),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			'wpsignal/v1',
			'/prompt/(?P<id>\d+)',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'handle_prompt' ),
				'permission_callback' => '__return_true',
			)
		);
		$uuid = array(
			'type'              => 'string',
			'required'          => true,
			'validate_callback' => static fn( $value ): bool => is_string( $value ) && 1 === preg_match( self::UUID_PATTERN, $value ),
		);
		$key  = array(
			'type'              => 'string',
			'required'          => true,
			'validate_callback' => static fn( $value ): bool => is_string( $value ) && 1 === preg_match( self::ID_PATTERN, $value ),
		);
		register_rest_route(
			'wpsignal/v1',
			'/fired',
			array(
				'methods'             => 'POST',
				'args'                => array(
					'v'      => $uuid,
					'n'      => $uuid,
					'rule'   => $key,
					'action' => $key,
					'step'   => array(
						'type'    => 'integer',
						'default' => 0,
						'minimum' => 0,
					),
					'ms'     => array(
						'type'    => 'integer',
						'default' => 0,
						'minimum' => 0,
					),
					'kind'   => array(
						'type'    => 'string',
						'default' => 'fired',
						'enum'    => self::FIRING_KINDS,
					),
					'data'   => array(
						'type'    => 'object',
						'default' => array(),
					),
				),
				'callback'            => array( $this, 'handle_fired' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * `GET /rules`: everything the builder needs.
	 *
	 * @return WP_REST_Response
	 */
	public function handle_get(): WP_REST_Response {
		return rest_ensure_response( $this->listing() );
	}

	/**
	 * The listing both staff routes answer with.
	 *
	 * @return array
	 */
	private function listing(): array {
		$saved = $this->saved();
		return array(
			'version'    => (int) $saved['version'],
			'rules'      => $this->all(),
			'removed'    => $saved['removed'],
			'vocabulary' => $this->vocabulary(),
			'kinds'      => $this->kinds(),
			'kindGroups' => $this->kind_groups(),
		);
	}

	/**
	 * `GET /rules/live`: what every browser already receives, for a tab re-syncing after a reconnect.
	 *
	 * @return WP_REST_Response
	 */
	public function handle_live(): WP_REST_Response {
		$response = new WP_REST_Response( $this->broadcast() );
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}

	/**
	 * `POST /rules`: save the rules.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function handle_post( WP_REST_Request $request ) {
		$rules = $request->get_param( 'rules' );
		if ( ! is_array( $rules ) ) {
			return new WP_Error( 'wpsignal_no_rules', __( 'Nothing to save.', 'wordsocket' ), array( 'status' => 400 ) );
		}
		$clean = $this->validate( $rules );
		if ( is_wp_error( $clean ) ) {
			return $clean;
		}
		$this->save( $clean );
		return rest_ensure_response( $this->listing() );
	}

	/**
	 * `GET /prompt/{id}`: a synced pattern rendered, for a prompt. Only ids an enabled rule names, and to anyone who asks.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function handle_prompt( WP_REST_Request $request ) {
		$id = (int) $request->get_param( 'id' );
		if ( ! in_array( $id, $this->referenced_patterns(), true ) || ! self::is_pattern( $id ) ) {
			return new WP_Error( 'wpsignal_unknown_prompt', __( 'No such prompt.', 'wordsocket' ), array( 'status' => 404 ) );
		}
		$post = get_post( $id );
		$html = do_blocks( (string) $post->post_content );
		$css  = function_exists( 'wp_style_engine_get_stylesheet_from_context' ) ? (string) wp_style_engine_get_stylesheet_from_context( 'block-supports' ) : '';
		if ( '' !== $css ) {
			$html = '<style>' . $css . '</style>' . $html;
		}
		$response = rest_ensure_response(
			array(
				'id'      => $id,
				'html'    => $html,
				'version' => (int) $this->saved()['version'],
			)
		);
		$response->header( 'Cache-Control', 'public, max-age=3600' );
		return $response;
	}

	/**
	 * Whether the enabled rule `$rule_id` has an action `$action`, so a firing report names something that can have fired.
	 *
	 * @param string $rule_id The rule.
	 * @param string $action  The action key.
	 * @return bool
	 */
	private function fires( string $rule_id, string $action ): bool {
		foreach ( $this->enabled() as $rule ) {
			if ( (string) $rule['id'] === $rule_id ) {
				return in_array( $action, array_column( (array) $rule['actions'], 'action' ), true );
			}
		}
		return false;
	}

	/**
	 * `POST /fired`: a browser reports a firing of an enabled rule; the journey keeps it while History is on, and `wpsignal_rule_fired` follows.
	 *
	 * @since 0.31.0 Stores the firing on the journey before the action.
	 *
	 * @since 0.31.0 Takes `ms` and `kind`.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function handle_fired( WP_REST_Request $request ) {
		if ( ! $this->fires( (string) $request->get_param( 'rule' ), (string) $request->get_param( 'action' ) ) ) {
			return new WP_Error( 'wpsignal_unknown_rule', __( 'No such moment.', 'wordsocket' ), array( 'status' => 404 ) );
		}
		$report = array(
			'visitor'    => strtolower( (string) $request->get_param( 'v' ) ),
			'journey_id' => strtolower( (string) $request->get_param( 'n' ) ),
			'rule_id'    => (string) $request->get_param( 'rule' ),
			'action'     => (string) $request->get_param( 'action' ),
			'step'       => max( 0, (int) $request->get_param( 'step' ) ),
			'ms'         => max( 0, (int) $request->get_param( 'ms' ) ),
			'kind'       => (string) $request->get_param( 'kind' ),
			'user_id'    => get_current_user_id(),
			'data'       => Presence::sanitize_data( (array) $request->get_param( 'data' ) ),
		);
		WPS::journeys()->on_fired( $report );
		/**
		 * Fires when a visitor's browser reports that a rule fired, after WordSocket has stored it (History on).
		 *
		 * @param array{visitor: string, journey_id: string, rule_id: string, action: string, step: int, ms: int, kind: string, user_id: int, data: array} $report The report: `ms` the elapsed time of the step, `kind` one of FIRING_KINDS.
		 */
		do_action( 'wpsignal_rule_fired', $report );
		$response = rest_ensure_response( array( 'ok' => true ) );
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}
}
