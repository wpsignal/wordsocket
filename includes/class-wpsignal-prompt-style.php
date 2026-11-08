<?php
/**
 * The look and behaviour of the prompts moments show, set once for every prompt and again per prompt type.
 *
 * - Saved in `wpsignal_prompt_style`: a style per scope, `all` and one per presentation.
 * - Printed as custom properties on the prompt layer and on each presentation's class, so the
 *   stylesheet's defaults and a theme's own `:root` values sit under what the merchant set.
 * - Colours, spacing and font sizes may be the theme's preset slugs, which print as `--wp--preset--*`.
 *
 * @package WPSignal
 */

namespace WPSignal;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The prompt style store, validator and printer.
 *
 * @since 0.31.0
 */
class Prompt_Style {

	/**
	 * The option that holds the styles.
	 *
	 * @since 0.31.0
	 */
	const OPTION = 'wpsignal_prompt_style';

	/**
	 * The configuration accessor.
	 *
	 * @var Config
	 */
	private $config;

	/**
	 * Constructor.
	 *
	 * @since 0.31.0
	 *
	 * @param Config $config Configuration accessor.
	 */
	public function __construct( Config $config ) {
		$this->config = $config;
	}

	/**
	 * The scopes: every prompt, then each presentation.
	 *
	 * @since 0.31.0
	 */
	const SCOPES = array( 'all', 'modal', 'banner', 'bar', 'toast', 'panel' );

	/**
	 * The motions a prompt may open with.
	 *
	 * @since 0.31.0
	 */
	const MOTIONS = array( 'slide', 'fade', 'none' );

	/**
	 * The fields a style may set: each a type and the scopes it applies to.
	 *
	 * @since 0.31.0
	 *
	 * @return array<string, array{type: string, scopes: string[]}>
	 */
	public static function fields(): array {
		$every = self::SCOPES;
		return array(
			'background' => array( 'type' => 'color', 'scopes' => $every ),
			'text'       => array( 'type' => 'color', 'scopes' => $every ),
			'border'     => array( 'type' => 'color', 'scopes' => $every ),
			'radius'     => array( 'type' => 'px', 'scopes' => $every, 'min' => 0, 'max' => 48 ),
			'padding'    => array( 'type' => 'spacing', 'scopes' => $every ),
			'fontSize'   => array( 'type' => 'font_size', 'scopes' => $every ),
			'shadow'     => array( 'type' => 'bool', 'scopes' => $every ),
			'close'      => array( 'type' => 'bool', 'scopes' => $every ),
			'motion'     => array( 'type' => 'motion', 'scopes' => array( 'all', 'banner', 'bar', 'toast', 'panel' ) ),
			'width'      => array( 'type' => 'px', 'scopes' => array( 'modal', 'panel' ), 'min' => 280, 'max' => 1200 ),
			'overlay'    => array( 'type' => 'overlay', 'scopes' => array( 'modal' ) ),
		);
	}

	/**
	 * The query parameter that shows a sample prompt on a front-end page, for whoever may style them.
	 *
	 * @since 0.31.0
	 */
	const PREVIEW_PARAM = 'wordsocket-preview';

	/**
	 * The text a sample prompt shows.
	 *
	 * @since 0.31.0
	 *
	 * @return string
	 */
	public static function sample_text(): string {
		return __( 'Still there? Your cart is waiting.', 'wordsocket' );
	}

	/**
	 * Whether this request may preview prompts on the site: a user who may style them, on a site in debug mode.
	 *
	 * @since 0.31.0
	 *
	 * @return bool
	 */
	public static function can_preview(): bool {
		return current_user_can( 'manage_options' ) && Config::is_debug();
	}

	/**
	 * The styles a site starts with: the modal and the panel roomier than the rest.
	 *
	 * @since 0.31.0
	 *
	 * @return array<string, array<string, mixed>>
	 */
	public static function defaults(): array {
		return array(
			'all'    => array(),
			'modal'  => array( 'padding' => '50' ),
			'banner' => array(),
			'bar'    => array(),
			'toast'  => array(),
			'panel'  => array( 'padding' => '50' ),
		);
	}

	/**
	 * The saved styles, every scope present and every value one the validator accepts, the defaults until something is saved.
	 *
	 * @since 0.31.0
	 *
	 * @return array<string, array<string, mixed>>
	 */
	public function saved(): array {
		$saved = $this->config->prompt_style();
		if ( null === $saved ) {
			return self::defaults();
		}
		$fields = self::fields();
		$styles = array();
		foreach ( self::SCOPES as $scope ) {
			$styles[ $scope ] = array();
			foreach ( (array) ( $saved[ $scope ] ?? array() ) as $key => $value ) {
				$field = $fields[ $key ] ?? null;
				$clean = $field && in_array( $scope, $field['scopes'], true ) ? self::clean( $field, $value ) : null;
				if ( null !== $clean ) {
					$styles[ $scope ][ $key ] = $clean;
				}
			}
		}
		return $styles;
	}

	/**
	 * Validate styles as sent, every scope and field checked; a field not allowed in a scope or an unknown field is refused.
	 *
	 * @since 0.31.0
	 *
	 * @param mixed $input The styles, keyed by scope.
	 * @return array<string, array<string, mixed>>|WP_Error
	 */
	public function validate( $input ) {
		if ( ! is_array( $input ) ) {
			return new WP_Error( 'wpsignal_invalid_style', __( 'The styles must be an object of scopes.', 'wordsocket' ), array( 'status' => 400 ) );
		}
		$fields = self::fields();
		$styles = array();
		foreach ( self::SCOPES as $scope ) {
			$given = $input[ $scope ] ?? array();
			if ( ! is_array( $given ) ) {
				return $this->refuse( $scope, '', __( 'A scope must be an object.', 'wordsocket' ) );
			}
			$styles[ $scope ] = array();
			foreach ( $given as $key => $value ) {
				$field = $fields[ $key ] ?? null;
				if ( null === $field || ! in_array( $scope, $field['scopes'], true ) ) {
					return $this->refuse( $scope, (string) $key, __( 'This field is not one this prompt has.', 'wordsocket' ) );
				}
				$clean = self::clean( $field, $value );
				if ( null === $clean ) {
					return $this->refuse( $scope, (string) $key, __( 'This value is not one the field takes.', 'wordsocket' ) );
				}
				$styles[ $scope ][ $key ] = $clean;
			}
		}
		foreach ( array_keys( $input ) as $scope ) {
			if ( ! in_array( $scope, self::SCOPES, true ) ) {
				return $this->refuse( (string) $scope, '', __( 'This is not a prompt type.', 'wordsocket' ) );
			}
		}
		return $styles;
	}

	/**
	 * Save validated styles.
	 *
	 * @since 0.31.0
	 *
	 * @param array<string, array<string, mixed>> $styles The styles, as `validate()` returned them.
	 * @return void
	 */
	public function save( array $styles ): void {
		$this->config->save_prompt_style( $styles );
	}

	/**
	 * The CSS that sets the saved styles, rendered once and kept until the styles, the theme or its global styles change.
	 *
	 * @since 0.31.0
	 *
	 * @return string
	 */
	public function css(): string {
		$kept = $this->config->prompt_style_css();
		if ( null !== $kept ) {
			return $kept;
		}
		$css = $this->render();
		$this->config->save_prompt_style_css( $css );
		return $css;
	}

	/**
	 * Forget the kept CSS, so the next page renders it again.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function forget_css(): void {
		$this->config->forget_prompt_style_css();
	}

	/**
	 * Render the CSS: the `all` scope on the prompt layer, each presentation on its class.
	 *
	 * @since 0.31.0
	 *
	 * @return string
	 */
	public function render(): string {
		$css     = '';
		$presets = $this->presets();
		foreach ( $this->saved() as $scope => $style ) {
			$declarations = self::declarations( $style, $presets );
			if ( '' === $declarations ) {
				continue;
			}
			$selector = 'all' === $scope ? '#wordsocket-prompts' : '.wordsocket-prompt--' . $scope;
			$css     .= $selector . '{' . $declarations . '}';
		}
		return $css;
	}

	/**
	 * The theme's palette, spacing sizes and font sizes, for the pickers; the theme's own where it defines them, core's otherwise.
	 *
	 * @since 0.31.0
	 *
	 * @return array{palette: array, spacingSizes: array, fontSizes: array}
	 */
	public function presets(): array {
		$pick = static function ( array $origins, array $keys ): array {
			$list = array();
			foreach ( array( 'theme', 'default' ) as $origin ) {
				if ( ! empty( $origins[ $origin ] ) && is_array( $origins[ $origin ] ) ) {
					$list = $origins[ $origin ];
					break;
				}
			}
			return array_values(
				array_map(
					static fn( array $item ): array => array_intersect_key( $item, array_flip( $keys ) ),
					array_filter( $list, static fn( $item ): bool => is_array( $item ) && isset( $item['slug'] ) )
				)
			);
		};
		return array(
			'palette'      => $pick( (array) wp_get_global_settings( array( 'color', 'palette' ) ), array( 'slug', 'name', 'color' ) ),
			'spacingSizes' => $pick( (array) wp_get_global_settings( array( 'spacing', 'spacingSizes' ) ), array( 'slug', 'name', 'size' ) ),
			'fontSizes'    => $pick( (array) wp_get_global_settings( array( 'typography', 'fontSizes' ) ), array( 'slug', 'name', 'size' ) ),
		);
	}

	/**
	 * The theme's custom properties alone, `--wp--preset--*` and `--wp--custom--*` on `:root`, so the dialog's sample resolves a preset as the front end does.
	 *
	 * @since 0.31.0
	 *
	 * @return string
	 */
	public function theme_variables(): string {
		return (string) wp_get_global_stylesheet( array( 'variables' ) );
	}

	/**
	 * The settings app's `wpsignalSettings.promptStyle`: the saved styles, the fields, the presets, the sample text and the routes.
	 *
	 * @since 0.31.0
	 *
	 * @return array
	 */
	public function config(): array {
		return array(
			'styles'     => $this->saved(),
			'fields'     => self::fields(),
			'presets'    => $this->presets(),
			'sampleText' => self::sample_text(),
			'url'        => rest_url( 'wpsignal/v1/prompt-style' ),
			// The front page with the preview parameter, the presentation appended by the dialog; only in debug mode.
			'preview'    => self::can_preview() ? home_url( '/?' . self::PREVIEW_PARAM . '=' ) : null,
		);
	}

	/**
	 * Hook the printing of the styles after the client's stylesheet is enqueued, and forget the kept CSS when what it was rendered from changes.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function init(): void {
		add_action( 'wp_enqueue_scripts', array( $this, 'print_styles' ), 20 );
		add_action( 'admin_enqueue_scripts', array( $this, 'print_styles' ), 20 );
		foreach ( array( 'add_option_' . self::OPTION, 'update_option_' . self::OPTION, 'delete_option_' . self::OPTION, 'switch_theme', 'save_post_wp_global_styles' ) as $hook ) {
			add_action( $hook, array( $this, 'forget_css' ) );
		}
	}

	/**
	 * Add the saved styles to the client's stylesheet when it is on the page.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function print_styles(): void {
		if ( ! wp_style_is( 'wpsignal', 'enqueued' ) ) {
			return;
		}
		$css = $this->css();
		if ( '' !== $css ) {
			wp_add_inline_style( 'wpsignal', $css );
		}
	}

	/**
	 * Register `GET` and `POST /wpsignal/v1/prompt-style`, both for `manage_options`.
	 *
	 * @since 0.31.0
	 *
	 * @return void
	 */
	public function register_routes(): void {
		$staff = static fn() => current_user_can( 'manage_options' );
		register_rest_route(
			'wpsignal/v1',
			'/prompt-style',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => fn() => rest_ensure_response( $this->config() ),
					'permission_callback' => $staff,
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'handle_post' ),
					'permission_callback' => $staff,
				),
			)
		);
	}

	/**
	 * Save the styles sent as `styles` and answer the config as saved.
	 *
	 * @since 0.31.0
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function handle_post( WP_REST_Request $request ) {
		$styles = $this->validate( $request->get_param( 'styles' ) );
		if ( is_wp_error( $styles ) ) {
			return $styles;
		}
		$this->save( $styles );
		return rest_ensure_response( $this->config() );
	}

	/**
	 * A validation refusal naming the scope and field.
	 *
	 * @since 0.31.0
	 *
	 * @param string $scope   The scope.
	 * @param string $field   The field, or empty.
	 * @param string $message What is wrong.
	 * @return WP_Error
	 */
	private function refuse( string $scope, string $field, string $message ): WP_Error {
		return new WP_Error(
			'wpsignal_invalid_style',
			$message,
			array(
				'status' => 400,
				'scope'  => $scope,
				'field'  => $field,
			)
		);
	}

	/**
	 * A field's value as stored, or null when it is not one the field takes.
	 *
	 * @since 0.31.0
	 *
	 * @param array $field The field spec.
	 * @param mixed $value The value as sent.
	 * @return mixed
	 */
	private static function clean( array $field, $value ) {
		switch ( $field['type'] ) {
			case 'color':
				return self::color( $value );
			case 'overlay':
				return 'none' === $value ? 'none' : self::color( $value );
			case 'px':
				if ( ! is_int( $value ) && ! is_float( $value ) ) {
					return null;
				}
				$px = (int) $value;
				return $px >= $field['min'] && $px <= $field['max'] ? $px : null;
			case 'spacing':
			case 'font_size':
				// A number is pixels; a string is a preset slug, and core's spacing slugs are numeric strings.
				if ( is_int( $value ) || ( is_float( $value ) && floor( $value ) === $value ) ) {
					$px = (int) $value;
					return $px >= 0 && $px <= 128 ? $px : null;
				}
				return self::slug( $value );
			case 'bool':
				return is_bool( $value ) ? $value : null;
			case 'motion':
				return in_array( $value, self::MOTIONS, true ) ? $value : null;
		}
		return null;
	}

	/**
	 * A colour as a lower-case hex literal or a preset slug, or null.
	 *
	 * @since 0.31.0
	 *
	 * @param mixed $value The value as sent.
	 * @return string|null
	 */
	private static function color( $value ): ?string {
		if ( ! is_string( $value ) ) {
			return null;
		}
		$value = strtolower( trim( $value ) );
		if ( 1 === preg_match( '/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/', $value ) ) {
			return $value;
		}
		return self::slug( $value );
	}

	/**
	 * A preset slug, or null.
	 *
	 * @since 0.31.0
	 *
	 * @param mixed $value The value as sent.
	 * @return string|null
	 */
	private static function slug( $value ): ?string {
		return is_string( $value ) && 1 === preg_match( '/^[a-z0-9][a-z0-9-]{0,63}$/', $value ) ? $value : null;
	}

	/**
	 * The custom properties one scope's style sets.
	 *
	 * @since 0.31.0
	 *
	 * @param array<string, mixed> $style   The style.
	 * @param array                $presets The theme's presets, for the fallback of each preset reference.
	 * @return string
	 */
	private static function declarations( array $style, array $presets ): string {
		$out    = '';
		$colors = array_column( $presets['palette'], 'color', 'slug' );
		$sizes  = array(
			'spacing'   => array_column( $presets['spacingSizes'], 'size', 'slug' ),
			'font-size' => array_column( $presets['fontSizes'], 'size', 'slug' ),
		);
		foreach ( $style as $key => $value ) {
			switch ( $key ) {
				case 'background':
					$out .= '--wordsocket-prompt-bg:' . self::color_css( $value, $colors ) . ';';
					break;
				case 'text':
					$out .= '--wordsocket-prompt-fg:' . self::color_css( $value, $colors ) . ';';
					break;
				case 'border':
					$out .= '--wordsocket-prompt-border:' . self::color_css( $value, $colors ) . ';';
					break;
				case 'radius':
					$out .= '--wordsocket-prompt-radius:' . (int) $value . 'px;';
					break;
				case 'padding':
					$out .= '--wordsocket-prompt-padding:' . self::size_css( $value, 'spacing', $sizes['spacing'], '16px' ) . ';';
					break;
				case 'fontSize':
					$out .= '--wordsocket-prompt-font-size:' . self::size_css( $value, 'font-size', $sizes['font-size'], '15px' ) . ';';
					break;
				case 'shadow':
					$out .= '--wordsocket-prompt-shadow:' . ( $value ? '0 8px 24px rgb(0 0 0 / 0.16)' : 'none' ) . ';';
					break;
				case 'close':
					$out .= $value ? '--wordsocket-prompt-close:block;--wordsocket-prompt-close-room:28px;' : '--wordsocket-prompt-close:none;--wordsocket-prompt-close-room:0px;';
					break;
				case 'motion':
					$out .= 'none' === $value ? '--wordsocket-prompt-motion:0ms;--wordsocket-prompt-slide:0;' : '--wordsocket-prompt-motion:240ms;--wordsocket-prompt-slide:' . ( 'slide' === $value ? '1' : '0' ) . ';';
					break;
				case 'width':
					$out .= '--wordsocket-prompt-width:' . (int) $value . 'px;';
					break;
				case 'overlay':
					$out .= '--wordsocket-prompt-overlay:' . ( 'none' === $value ? 'transparent' : self::color_css( $value, $colors ) ) . ';';
					break;
			}
		}
		return $out;
	}

	/**
	 * A stored colour as CSS: a hex literal as is, a slug as the theme's preset with its current value as the fallback.
	 *
	 * @since 0.31.0
	 *
	 * @param string                $value  The stored colour.
	 * @param array<string, string> $colors The palette, colour by slug.
	 * @return string
	 */
	private static function color_css( string $value, array $colors ): string {
		if ( '#' === $value[0] ) {
			return $value;
		}
		$fallback = isset( $colors[ $value ] ) ? ', ' . $colors[ $value ] : '';
		return 'var(--wp--preset--color--' . $value . $fallback . ')';
	}

	/**
	 * A stored size as CSS: pixels as is, a slug as the theme's preset with its current value, or `$literal`, as the fallback.
	 *
	 * @since 0.31.0
	 *
	 * @param int|string            $value   The stored size.
	 * @param string                $kind    `spacing` or `font-size`.
	 * @param array<string, string> $sizes   The presets of that kind, size by slug.
	 * @param string                $literal The fallback when the slug is not a preset.
	 * @return string
	 */
	private static function size_css( $value, string $kind, array $sizes, string $literal ): string {
		if ( is_int( $value ) ) {
			return $value . 'px';
		}
		return 'var(--wp--preset--' . $kind . '--' . $value . ', ' . ( $sizes[ $value ] ?? $literal ) . ')';
	}
}
