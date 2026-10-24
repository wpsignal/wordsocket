<?php
/**
 * WPSignal\Presence: the server half of `WPS.presence.track()`.
 *
 * The browser keeps a visitor's journey (`kind:id:ms` steps joined by `>`,
 * one journey per visit) and enters relay presence with it; this class names
 * the page it is on and takes the two reports it sends WordPress, a visit and
 * a leave, handing each to an action.
 *
 * @package WordSocket
 */

namespace WPSignal;

use WP_REST_Request, WP_REST_Response;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Page steps and the visit and leave routes.
 */
class Presence {

	/** Longest journey string accepted (50 steps of `kind:id:ms` is well under this). */
	const MAX_JOURNEY_BYTES = 4000;

	/** A journey: `kind:id:ms` steps joined by `>`. Ids only, never a URL or a word. */
	const JOURNEY_PATTERN = '/^[a-z_]+:\d+:\d+(>[a-z_]+:\d+:\d+)*$/';

	/** The visitor id and the journey id are version 4 UUIDs. */
	const UUID_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

	/** Most fields a plugin may attach to a report, and the longest value. */
	const MAX_DATA_FIELDS = 20;
	const MAX_DATA_BYTES  = 200;

	/**
	 * The step this request's page is, as `{ kind, id }`: the post type and id
	 * for singular pages, the taxonomy and term id for term archives, an
	 * id-less kind for everything else, `admin` in wp-admin.
	 *
	 * @return array{kind: string, id: int}
	 */
	public function page_step(): array {
		$step = $this->detect_step();
		/**
		 * Filters the step the current page is in a visitor's journey.
		 *
		 * @param array{kind: string, id: int} $step The detected kind and id.
		 */
		$step = apply_filters( 'wpsignal_page_step', $step );
		$kind = sanitize_key( (string) ( $step['kind'] ?? 'other' ) );
		return array(
			'kind' => '' === $kind ? 'other' : $kind,
			'id'   => max( 0, (int) ( $step['id'] ?? 0 ) ),
		);
	}

	/**
	 * The step before the filter.
	 *
	 * @return array{kind: string, id: int}
	 */
	private function detect_step(): array {
		if ( is_admin() ) {
			return array(
				'kind' => 'admin',
				'id'   => 0,
			);
		}
		if ( is_front_page() ) {
			return array(
				'kind' => 'home',
				'id'   => (int) get_queried_object_id(),
			);
		}
		if ( is_singular() ) {
			$type = get_post_type();
			return array(
				'kind' => is_string( $type ) ? $type : 'post',
				'id'   => (int) get_queried_object_id(),
			);
		}
		if ( is_category() ) {
			return array(
				'kind' => 'category',
				'id'   => (int) get_queried_object_id(),
			);
		}
		if ( is_tag() ) {
			return array(
				'kind' => 'tag',
				'id'   => (int) get_queried_object_id(),
			);
		}
		if ( is_tax() ) {
			$term = get_queried_object();
			return array(
				'kind' => (string) ( $term->taxonomy ?? 'term' ),
				'id'   => (int) get_queried_object_id(),
			);
		}
		if ( is_search() ) {
			return array(
				'kind' => 'search',
				'id'   => 0,
			);
		}
		// A post type's archive is its own kind (`post_archive` is the blog index), so "Archive is Posts" can name it without the single posts.
		if ( is_home() ) {
			return array(
				'kind' => 'post_archive',
				'id'   => (int) get_queried_object_id(),
			);
		}
		if ( is_post_type_archive() ) {
			$type = get_queried_object();
			return array(
				'kind' => ( $type instanceof \WP_Post_Type ? $type->name : 'other' ) . '_archive',
				'id'   => 0,
			);
		}
		if ( is_archive() ) {
			return array(
				'kind' => 'archive',
				'id'   => 0,
			);
		}
		return array(
			'kind' => 'other',
			'id'   => 0,
		);
	}

	/**
	 * What the client needs for `track()`: this page's step and the two routes.
	 *
	 * @return array{kind: string, id: int, visitUrl: string, leaveUrl: string}
	 */
	public function config(): array {
		$step = $this->page_step();
		return array(
			'kind'     => $step['kind'],
			'id'       => $step['id'],
			'visitUrl' => rest_url( 'wpsignal/v1/visit' ),
			'leaveUrl' => rest_url( 'wpsignal/v1/leave' ),
		);
	}

	/**
	 * Register `POST /wpsignal/v1/visit` and `/leave`.
	 *
	 * Hooked to `rest_api_init` during WPS::boot().
	 *
	 * @return void
	 */
	public function register_routes() {
		$uuid   = array(
			'type'              => 'string',
			'required'          => true,
			'validate_callback' => static fn( $value ): bool => is_string( $value ) && 1 === preg_match( self::UUID_PATTERN, $value ),
		);
		$args   = array(
			'v'       => $uuid,
			'n'       => $uuid,
			'journey' => array(
				'type'              => 'string',
				'default'           => '',
				'validate_callback' => static fn( $value ): bool => is_string( $value )
					&& strlen( $value ) <= self::MAX_JOURNEY_BYTES
					&& ( '' === $value || 1 === preg_match( self::JOURNEY_PATTERN, $value ) ),
			),
			'data'    => array(
				'type'              => 'object',
				'default'           => array(),
				'validate_callback' => static fn( $value ): bool => is_array( $value ) && count( $value ) <= self::MAX_DATA_FIELDS,
			),
		);
		$routes = array(
			'visit' => false,
			'leave' => true,
		);
		foreach ( $routes as $route => $leaving ) {
			register_rest_route(
				'wpsignal/v1',
				'/' . $route,
				array(
					'methods'             => 'POST',
					'args'                => $args,
					'callback'            => fn( WP_REST_Request $request ) => $this->handle_report( $request, $leaving ),
					'permission_callback' => '__return_true',
				)
			);
		}
	}

	/**
	 * Hand a report to the action for it.
	 *
	 * @param WP_REST_Request $request The request.
	 * @param bool            $leaving Whether this is `/leave`.
	 * @return WP_REST_Response
	 */
	public function handle_report( WP_REST_Request $request, bool $leaving ): WP_REST_Response {
		$journey = (string) $request->get_param( 'journey' );
		$report  = array(
			'visitor'    => strtolower( (string) $request->get_param( 'v' ) ),
			'journey_id' => strtolower( (string) $request->get_param( 'n' ) ),
			'journey'    => $journey,
			'steps'      => self::steps( $journey ),
			'user_id'    => get_current_user_id(),
			'data'       => self::sanitize_data( (array) $request->get_param( 'data' ) ),
			'leaving'    => $leaving,
		);
		if ( $leaving ) {
			/**
			 * Fires when a visitor's browser reports leaving a page (`pagehide`),
			 * with the journey closed.
			 *
			 * @param array{visitor: string, journey_id: string, journey: string, steps: int, user_id: int, data: array, leaving: bool} $report The report.
			 */
			do_action( 'wpsignal_visitor_leave', $report );
		} else {
			/**
			 * Fires when a visitor's browser reports arriving on a page, with the
			 * journey so far (this page's step open).
			 *
			 * @param array{visitor: string, journey_id: string, journey: string, steps: int, user_id: int, data: array, leaving: bool} $report The report.
			 */
			do_action( 'wpsignal_visitor_visit', $report );
		}
		$answer = array( 'ok' => true );
		if ( ! $leaving ) {
			/**
			 * Filters what the visit route answers beyond `ok`, so a plugin hands the
			 * browser its own state in the request the page already makes (ShopSocket
			 * answers the cart under `shopsocket`). Each plugin keeps to one key of its
			 * own; `ok` cannot be overridden. The browser reads it through
			 * `tracker.onVisit()`.
			 *
			 * @param array $answer Fields to add, empty to begin with.
			 * @param array{visitor: string, journey_id: string, journey: string, steps: int, user_id: int, data: array, leaving: bool} $report The report.
			 */
			$answer = array( 'ok' => true ) + (array) apply_filters( 'wpsignal_visitor_visit_response', array(), $report );
		}
		$response = rest_ensure_response( $answer );
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}

	/**
	 * How many steps a journey string holds.
	 *
	 * @param string $journey The journey.
	 * @return int
	 */
	public static function steps( string $journey ): int {
		return '' === $journey ? 0 : substr_count( $journey, '>' ) + 1;
	}

	/**
	 * A plugin's fields, reduced to what a report may carry: snake-case keys,
	 * scalar values, strings cut at MAX_DATA_BYTES. Nested values are dropped.
	 *
	 * @param array $data The `data` object as sent.
	 * @return array<string, string|int|float|bool>
	 */
	public static function sanitize_data( array $data ): array {
		$clean = array();
		foreach ( $data as $key => $value ) {
			$key = sanitize_key( (string) $key );
			if ( '' === $key || ! is_scalar( $value ) ) {
				continue;
			}
			$clean[ $key ] = is_string( $value ) ? substr( sanitize_text_field( $value ), 0, self::MAX_DATA_BYTES ) : $value;
			if ( count( $clean ) >= self::MAX_DATA_FIELDS ) {
				break;
			}
		}
		return $clean;
	}
}
