<?php
/**
 * Abilities: moments, journeys and the events channel for agents, through WordPress's Abilities API.
 *
 * - One `wordsocket` category and seven abilities, each a thin wrapper over `Rules`, `Journeys` or `Publisher`.
 * - Every ability needs `manage_options`, as the routes behind it do, and every one is public, so the abilities REST routes and the MCP adapter offer them.
 * - Nothing is registered on a WordPress without `wp_register_ability()` (before 6.9).
 *
 * @package WPSignal
 */

namespace WPSignal;

use WP_Error;

/**
 * The abilities and their registration.
 *
 * @since 0.31.0
 */
class Abilities {

	/**
	 * The ability category every ability is registered under.
	 *
	 * @since 0.31.0
	 */
	const CATEGORY = 'wordsocket';

	/**
	 * The capability every ability needs.
	 *
	 * @since 0.31.0
	 */
	const CAPABILITY = 'manage_options';

	/**
	 * Journeys an ability answers by default.
	 *
	 * @since 0.31.0
	 */
	const JOURNEYS_LIMIT = 100;

	/**
	 * Most journeys an ability answers.
	 *
	 * @since 0.31.0
	 */
	const JOURNEYS_MAX_LIMIT = 1000;

	/**
	 * Patterns `describe-moments` lists at most.
	 *
	 * @since 0.31.0
	 */
	const PATTERNS = 100;

	/**
	 * The ability names, under the `wordsocket/` namespace.
	 *
	 * @since 0.31.0
	 */
	const NAMES = array( 'describe-moments', 'list-moments', 'save-moment', 'enable-moment', 'delete-moment', 'publish-event', 'list-journeys' );

	/**
	 * The rules registry and store.
	 *
	 * @var Rules
	 */
	private Rules $rules;

	/**
	 * The journeys store.
	 *
	 * @var Journeys
	 */
	private Journeys $journeys;

	/**
	 * The publisher.
	 *
	 * @var Publisher
	 */
	private Publisher $publisher;

	/**
	 * Constructor.
	 *
	 * @since 0.31.0
	 *
	 * @param Rules     $rules     The rules registry and store.
	 * @param Journeys  $journeys  The journeys store.
	 * @param Publisher $publisher The publisher.
	 */
	public function __construct( Rules $rules, Journeys $journeys, Publisher $publisher ) {
		$this->rules     = $rules;
		$this->journeys  = $journeys;
		$this->publisher = $publisher;
	}

	/**
	 * Whether this WordPress has the Abilities API.
	 *
	 * @since 0.31.0
	 *
	 * @return bool
	 */
	public static function available(): bool {
		return function_exists( 'wp_register_ability' ) && function_exists( 'wp_register_ability_category' );
	}

	/**
	 * Hook the category and the abilities onto the API's registration actions.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function init(): void {
		if ( ! self::available() ) {
			return;
		}
		add_action( 'wp_abilities_api_categories_init', array( $this, 'register_category' ) );
		add_action( 'wp_abilities_api_init', array( $this, 'register' ) );
	}

	/**
	 * Register the `wordsocket` category.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function register_category(): void {
		wp_register_ability_category(
			self::CATEGORY,
			array(
				'label'       => __( 'WordSocket', 'wordsocket' ),
				'description' => __( 'The moments a site shows its visitors, the journeys it keeps, and its realtime events channel.', 'wordsocket' ),
			)
		);
	}

	/**
	 * Register the abilities.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function register(): void {
		$permission  = static fn(): bool => current_user_can( self::CAPABILITY );
		$moment      = self::moment_schema();
		$shared      = array(
			'category'            => self::CATEGORY,
			'permission_callback' => $permission,
		);
		$readonly    = array(
			'annotations' => array( 'readonly' => true ),
			'public'      => true,
		);
		$additive    = array(
			'annotations' => array(
				'readonly'    => false,
				'destructive' => false,
			),
			'public'      => true,
		);
		$destructive = array(
			'annotations' => array(
				'readonly'    => false,
				'destructive' => true,
			),
			'public'      => true,
		);

		wp_register_ability(
			'wordsocket/describe-moments',
			$shared + array(
				'label'            => __( 'Describe moments', 'wordsocket' ),
				'input_schema'     => self::object_schema( array() ),
				'description'      => __( 'The vocabulary a moment is built from: every condition and action with its operators and value types, the page kinds, the synced patterns a moment may show, the site\'s timezone, the limits, and the moment\'s own fields (how often it shows, the attention flash on a hidden tab, each action\'s delay). Read it before saving a moment.', 'wordsocket' ),
				'output_schema'    => self::object_schema(
					array(
						'vocabulary' => array( 'type' => 'object' ),
						'kinds'      => array( 'type' => 'object' ),
						'kindGroups' => array( 'type' => 'object' ),
						'patterns'   => array( 'type' => 'array' ),
						'timezone'   => array( 'type' => 'string' ),
						'limits'     => array( 'type' => 'object' ),
						'moment'     => array( 'type' => 'object' ),
					)
				),
				'execute_callback' => array( $this, 'describe' ),
				'meta'             => $readonly,
			)
		);
		wp_register_ability(
			'wordsocket/list-moments',
			$shared + array(
				'label'            => __( 'List moments', 'wordsocket' ),
				'input_schema'     => self::object_schema( array() ),
				'description'      => __( 'Every moment the site has, enabled or not, with the keys an inactive extension left unavailable, and whether moments are switched on for the site: while they are off, on the Settings tab, no moment reaches a visitor.', 'wordsocket' ),
				'output_schema'    => self::object_schema(
					array(
						'version' => array( 'type' => 'integer' ),
						'live'    => array( 'type' => 'boolean' ),
						'moments' => array(
							'type'  => 'array',
							'items' => $moment,
						),
					)
				),
				'execute_callback' => array( $this, 'list_moments' ),
				'meta'             => $readonly,
			)
		);
		wp_register_ability(
			'wordsocket/save-moment',
			$shared + array(
				'label'            => __( 'Save a moment', 'wordsocket' ),
				'description'      => __( 'Create or update one moment. A new moment is saved switched off; switch it on with enable-moment once it reads right. The conditions and actions must use the vocabulary describe-moments lists.', 'wordsocket' ),
				'input_schema'     => self::object_schema( array( 'moment' => $moment ), array( 'moment' ) ),
				'output_schema'    => $moment,
				'execute_callback' => array( $this, 'save_moment' ),
				'meta'             => $additive,
			)
		);
		wp_register_ability(
			'wordsocket/enable-moment',
			$shared + array(
				'label'            => __( 'Switch a moment on or off', 'wordsocket' ),
				'description'      => __( 'Switch a moment on, so visitors start seeing it, or off.', 'wordsocket' ),
				'input_schema'     => self::object_schema(
					array(
						'id'      => array( 'type' => 'string' ),
						'enabled' => array( 'type' => 'boolean' ),
					),
					array( 'id', 'enabled' )
				),
				'output_schema'    => $moment,
				'execute_callback' => array( $this, 'enable_moment' ),
				'meta'             => $destructive,
			)
		);
		wp_register_ability(
			'wordsocket/delete-moment',
			$shared + array(
				'label'            => __( 'Delete a moment', 'wordsocket' ),
				'description'      => __( 'Delete a moment. A moment WordSocket or an extension ships stays deleted until it is saved again.', 'wordsocket' ),
				'input_schema'     => self::object_schema( array( 'id' => array( 'type' => 'string' ) ), array( 'id' ) ),
				'output_schema'    => self::object_schema( array( 'deleted' => array( 'type' => 'string' ) ) ),
				'execute_callback' => array( $this, 'delete_moment' ),
				'meta'             => $destructive,
			)
		);
		wp_register_ability(
			'wordsocket/publish-event',
			$shared + array(
				'label'            => __( 'Publish an event', 'wordsocket' ),
				'description'      => __( 'Publish an event with a JSON payload on one of the site\'s realtime channels, as a trigger would; every browser subscribed to the channel receives it at once.', 'wordsocket' ),
				'input_schema'     => self::object_schema(
					array(
						'channel' => array( 'type' => 'string' ),
						'event'   => array( 'type' => 'string' ),
						'data'    => array( 'type' => 'object' ),
					),
					array( 'channel', 'event' )
				),
				'output_schema'    => self::object_schema( array( 'ok' => array( 'type' => 'boolean' ) ) ),
				'execute_callback' => array( $this, 'publish_event' ),
				'meta'             => $additive,
			)
		);
		wp_register_ability(
			'wordsocket/list-journeys',
			$shared + array(
				'label'            => __( 'List journeys', 'wordsocket' ),
				'description'      => __( 'The visits the site kept, newest first: each visitor\'s pages in order with the seconds spent, the outcome, the value, what they carried and the moments that fired. The legend explains every field.', 'wordsocket' ),
				'input_schema'     => self::object_schema(
					array(
						'days'    => array(
							'type'    => 'integer',
							'minimum' => 1,
							'maximum' => Journeys::QUERY_MAX_DAYS,
						),
						'limit'   => array(
							'type'    => 'integer',
							'minimum' => 1,
							'maximum' => self::JOURNEYS_MAX_LIMIT,
						),
						'outcome' => array( 'type' => 'string' ),
						'ref'     => array( 'type' => 'string' ),
						'user_id' => array( 'type' => 'integer' ),
						'visitor' => array( 'type' => 'string' ),
						'rule'    => array( 'type' => 'string' ),
					)
				),
				'output_schema'    => self::object_schema(
					array(
						'count'    => array( 'type' => 'integer' ),
						'currency' => array( 'type' => 'string' ),
						'legend'   => array( 'type' => 'object' ),
						'journeys' => array( 'type' => 'array' ),
					)
				),
				'execute_callback' => array( $this, 'list_journeys' ),
				'meta'             => $readonly,
			)
		);
	}

	/**
	 * An object schema with the given properties and required keys; with none required, no input reads as an empty object.
	 *
	 * @since 0.31.0
	 *
	 * @param array    $properties The properties, each a schema.
	 * @param string[] $required   The required keys.
	 * @return array
	 */
	private static function object_schema( array $properties, array $required = array() ): array {
		$schema = array( 'type' => 'object' );
		if ( $properties ) {
			$schema['properties'] = $properties;
		}
		if ( $required ) {
			$schema['required'] = $required;
		} else {
			$schema['default'] = array();
		}
		return $schema;
	}

	/**
	 * The schema of a moment as the API takes and returns it; `Rules::validate()` checks the rest.
	 *
	 * @since 0.31.0
	 *
	 * @return array
	 */
	private static function moment_schema(): array {
		return self::object_schema(
			array(
				'id'         => array(
					'type'        => 'string',
					'description' => __( 'Leave empty to create a moment.', 'wordsocket' ),
				),
				'name'       => array( 'type' => 'string' ),
				'enabled'    => array( 'type' => 'boolean' ),
				'frequency'  => array(
					'type'        => 'string',
					'enum'        => Rules::FREQUENCIES,
					'description' => __( 'How often it shows: always (on every transition into its conditions), page (at most once per page view), visit (once per visit, the default) or visitor (once per browser).', 'wordsocket' ),
				),
				'rev'        => array( 'type' => 'integer' ),
				'source'     => array( 'type' => 'string' ),
				'attention'  => array(
					'type'        => 'object',
					'description' => __( 'Grab their attention: when the moment fires while the tab is hidden, flash the tab title and mark the icon until the visitor comes back. Off unless enabled.', 'wordsocket' ),
					'properties'  => array(
						'enabled' => array( 'type' => 'boolean' ),
						'title'   => array(
							'type'        => 'string',
							'maxLength'   => Rules::MAX_TITLE,
							'description' => __( 'The tab title to flash; "Still there?" when empty.', 'wordsocket' ),
						),
					),
				),
				'conditions' => array(
					'type'        => 'object',
					'description' => __( 'A group: { all: [...] } or { any: [...] } of { condition, op, value } or nested groups.', 'wordsocket' ),
				),
				'actions'    => array(
					'type'        => 'array',
					'description' => __( 'Each { action, ...params }; every action takes after, seconds to wait from the firing (0 to 3600), on a visible or a hidden tab alike.', 'wordsocket' ),
					'items'       => array( 'type' => 'object' ),
				),
			)
		);
	}

	/**
	 * `describe-moments`.
	 *
	 * @since 0.31.0
	 *
	 * @param mixed $input Unused.
	 * @return array
	 */
	public function describe( $input = null ): array {
		unset( $input );
		$patterns = array();
		foreach ( get_posts(
			array(
				'post_type'   => 'wp_block',
				'post_status' => 'publish',
				'numberposts' => self::PATTERNS,
				'orderby'     => 'title',
				'order'       => 'ASC',
			)
		) as $post ) {
			$patterns[] = array(
				'id'    => (int) $post->ID,
				'title' => (string) $post->post_title,
			);
		}
		return array(
			'vocabulary' => $this->rules->vocabulary(),
			'kinds'      => $this->rules->kinds(),
			'kindGroups' => $this->rules->kind_groups(),
			'patterns'   => $patterns,
			'timezone'   => wp_timezone_string(),
			'limits'     => array(
				'moments'    => Rules::MAX_RULES,
				'conditions' => Rules::MAX_CONDITIONS,
				'actions'    => Rules::MAX_ACTIONS,
				'text'       => Rules::MAX_TEXT,
				'after'      => Rules::MAX_AFTER,
				'title'      => Rules::MAX_TITLE,
			),
			'moment'     => array(
				'frequency' => array(
					'always'  => __( 'Repeatedly: every time the conditions turn true.', 'wordsocket' ),
					'page'    => __( 'At most once per page view.', 'wordsocket' ),
					'visit'   => __( 'Once per visit (the default).', 'wordsocket' ),
					'visitor' => __( 'Once per visitor, remembered in their browser.', 'wordsocket' ),
				),
				'attention' => __( 'attention: { enabled, title }. With enabled true, a moment that fires while the tab is hidden flashes the tab title (title, or "Still there?") and marks the icon until the visitor returns; the actions still run at once, so a prompt is there on the return.', 'wordsocket' ),
				'after'     => __( 'Every action takes after, in seconds (0 to 3600): the wait from the firing before it runs, counted whether the tab is visible or hidden, called off if the moment turns false meanwhile.', 'wordsocket' ),
			),
		);
	}

	/**
	 * `list-moments`.
	 *
	 * @since 0.31.0
	 *
	 * @param mixed $input Unused.
	 * @return array
	 */
	public function list_moments( $input = null ): array {
		unset( $input );
		return array(
			'version' => (int) $this->rules->saved()['version'],
			'live'    => $this->rules->live(),
			'moments' => $this->rules->all(),
		);
	}

	/**
	 * `save-moment`: a new moment is saved switched off, an existing one keeps its switch.
	 *
	 * @since 0.31.0
	 *
	 * @param array $input `{ moment }`.
	 * @return array|WP_Error The moment as saved.
	 */
	public function save_moment( array $input ) {
		$moment = (array) ( $input['moment'] ?? array() );
		$id     = (string) ( $moment['id'] ?? '' );
		if ( '' === $id ) {
			$id           = bin2hex( random_bytes( 4 ) );
			$moment['id'] = $id;
		}
		$moments  = $this->moments();
		$existing = $moments[ $id ] ?? null;
		unset( $moment['unavailable'] );
		$moment['enabled'] = null === $existing ? false : (bool) $existing['enabled'];
		$moments[ $id ]    = $moment;
		$saved             = $this->store( $moments );
		if ( is_wp_error( $saved ) ) {
			return $saved;
		}
		return $saved[ $id ] ?? new WP_Error( 'wpsignal_not_saved', __( 'The moment was not saved.', 'wordsocket' ) );
	}

	/**
	 * `enable-moment`.
	 *
	 * @since 0.31.0
	 *
	 * @param array $input `{ id, enabled }`.
	 * @return array|WP_Error The moment as saved.
	 */
	public function enable_moment( array $input ) {
		$id      = (string) ( $input['id'] ?? '' );
		$moments = $this->moments();
		if ( ! isset( $moments[ $id ] ) ) {
			return new WP_Error( 'wpsignal_unknown_moment', __( 'No such moment.', 'wordsocket' ), array( 'status' => 404 ) );
		}
		$moments[ $id ]['enabled'] = ! empty( $input['enabled'] );
		$saved                     = $this->store( $moments );
		return is_wp_error( $saved ) ? $saved : $saved[ $id ];
	}

	/**
	 * `delete-moment`.
	 *
	 * @since 0.31.0
	 *
	 * @param array $input `{ id }`.
	 * @return array|WP_Error `{ deleted }`.
	 */
	public function delete_moment( array $input ) {
		$id      = (string) ( $input['id'] ?? '' );
		$moments = $this->moments();
		if ( ! isset( $moments[ $id ] ) ) {
			return new WP_Error( 'wpsignal_unknown_moment', __( 'No such moment.', 'wordsocket' ), array( 'status' => 404 ) );
		}
		unset( $moments[ $id ] );
		$saved = $this->store( $moments );
		return is_wp_error( $saved ) ? $saved : array( 'deleted' => $id );
	}

	/**
	 * `publish-event`.
	 *
	 * @since 0.31.0
	 *
	 * @param array $input `{ channel, event, data }`.
	 * @return array|WP_Error `{ ok }`.
	 */
	public function publish_event( array $input ) {
		$channel = (string) ( $input['channel'] ?? '' );
		$event   = (string) ( $input['event'] ?? '' );
		if ( '' === $channel || '' === $event ) {
			return new WP_Error( 'wpsignal_missing_params', __( 'Channel and event are required.', 'wordsocket' ), array( 'status' => 400 ) );
		}
		$result = $this->publisher->publish( $channel, $event, (array) ( $input['data'] ?? array() ) );
		return is_wp_error( $result ) ? $result : array( 'ok' => true );
	}

	/**
	 * `list-journeys`.
	 *
	 * @since 0.31.0
	 *
	 * @param array $input The filters: `days`, `limit`, `outcome`, `ref`, `user_id`, `visitor`, `rule`.
	 * @return array|WP_Error `{ count, currency, legend, journeys }`.
	 */
	public function list_journeys( array $input = array() ) {
		$args = array(
			'days'  => (int) ( $input['days'] ?? Journeys::QUERY_DAYS ),
			'limit' => min( self::JOURNEYS_MAX_LIMIT, max( 1, (int) ( $input['limit'] ?? self::JOURNEYS_LIMIT ) ) ),
		);
		foreach ( array( 'outcome', 'ref', 'visitor', 'rule' ) as $key ) {
			if ( isset( $input[ $key ] ) && '' !== $input[ $key ] ) {
				$args[ $key ] = (string) $input[ $key ];
			}
		}
		if ( ! empty( $input['user_id'] ) ) {
			$args['user'] = (int) $input['user_id'];
		}
		$journeys = Journeys::query( $args );
		if ( is_wp_error( $journeys ) ) {
			return $journeys;
		}
		return array(
			'count'    => count( $journeys ),
			'currency' => $this->journeys->currency(),
			'legend'   => Journeys::legend(),
			'journeys' => $journeys,
		);
	}

	/**
	 * Every moment by id, saved and shipped alike, as the builder posts them.
	 *
	 * @since 0.31.0
	 *
	 * @return array<string, array>
	 */
	private function moments(): array {
		$by_id = array();
		foreach ( $this->rules->all() as $rule ) {
			unset( $rule['unavailable'] );
			$by_id[ (string) $rule['id'] ] = $rule;
		}
		return $by_id;
	}

	/**
	 * Validate and save the whole list, as a save from the builder does, answering the saved moments by id.
	 *
	 * @since 0.31.0
	 *
	 * @param array<string, array> $moments The moments by id.
	 * @return array<string, array>|WP_Error
	 */
	private function store( array $moments ) {
		$clean = $this->rules->validate( array_values( $moments ) );
		if ( is_wp_error( $clean ) ) {
			return $clean;
		}
		$saved = array();
		foreach ( $this->rules->save( $clean )['rules'] as $rule ) {
			$saved[ (string) $rule['id'] ] = $rule;
		}
		return $saved;
	}
}
