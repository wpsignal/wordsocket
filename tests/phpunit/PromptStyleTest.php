<?php
/**
 * The prompt styles: validation, the printed custom properties and the route.
 */

use WPSignal\Prompt_Style;
use WPSignal\WPS;

class PromptStyleTest extends WordSocketTestCase {

	public function test_the_defaults_print_only_the_roomier_modal_and_panel(): void {
		delete_option( Prompt_Style::OPTION );
		$style = WPS::prompt_style();
		$this->assertSame( Prompt_Style::defaults(), $style->saved() );
		$css = $style->css();
		$this->assertStringContainsString( '.wordsocket-prompt--modal{--wordsocket-prompt-padding:var(--wp--preset--spacing--50, ', $css );
		$this->assertStringContainsString( '.wordsocket-prompt--panel{', $css );
		$this->assertStringNotContainsString( '#wordsocket-prompts', $css, 'nothing set for every prompt' );
	}

	public function test_a_style_is_validated_field_by_field_and_printed_as_custom_properties(): void {
		$style = WPS::prompt_style();
		$clean = $style->validate(
			array(
				'all'   => array(
					'background' => 'base',
					'text'       => '#1E1E1E',
					'radius'     => 12,
					'padding'    => 20,
					'fontSize'   => 'medium',
					'shadow'     => false,
					'close'      => true,
					'motion'     => 'fade',
				),
				'modal' => array(
					'width'   => 640,
					'overlay' => 'none',
					'close'   => false,
					'padding' => '60',
				),
				'toast' => array( 'motion' => 'none' ),
			)
		);
		$this->assertIsArray( $clean );
		$this->assertSame( '#1e1e1e', $clean['all']['text'], 'hex is lower-cased' );
		$this->assertSame( 20, $clean['all']['padding'], 'a number is pixels' );
		$this->assertSame( '60', $clean['modal']['padding'], 'a numeric string is a preset slug' );
		$this->assertSame( array(), $clean['banner'], 'every scope is present' );

		$style->save( $clean );
		$css = $style->css();
		$this->assertStringContainsString( '#wordsocket-prompts{', $css );
		$this->assertStringContainsString( '--wordsocket-prompt-bg:var(--wp--preset--color--base', $css );
		$this->assertStringContainsString( '--wordsocket-prompt-fg:#1e1e1e;', $css );
		$this->assertStringContainsString( '--wordsocket-prompt-radius:12px;', $css );
		$this->assertStringContainsString( '--wordsocket-prompt-padding:20px;', $css );
		$this->assertStringContainsString( '--wordsocket-prompt-font-size:var(--wp--preset--font-size--medium, ', $css );
		$this->assertStringContainsString( '--wordsocket-prompt-shadow:none;', $css );
		$this->assertStringContainsString( '--wordsocket-prompt-motion:240ms;--wordsocket-prompt-slide:0;', $css, 'fade keeps the duration and drops the slide' );
		$this->assertStringContainsString( '.wordsocket-prompt--modal{--wordsocket-prompt-width:640px;--wordsocket-prompt-overlay:transparent;--wordsocket-prompt-close:none;--wordsocket-prompt-close-room:0px;--wordsocket-prompt-padding:var(--wp--preset--spacing--60, ', $css );
		$this->assertStringContainsString( '.wordsocket-prompt--toast{--wordsocket-prompt-motion:0ms;--wordsocket-prompt-slide:0;}', $css );

		// Rendered once and kept; a write to the option, by whoever, forgets it, and a value written past the validator is dropped on read.
		$this->assertSame( $css, get_option( 'wpsignal_prompt_style_css' ), 'the render is kept' );
		update_option( Prompt_Style::OPTION, array( 'all' => array( 'radius' => 4, 'background' => '#fff;}</style>', 'width' => 300 ) ) );
		$this->assertSame( array( 'radius' => 4 ), $style->saved()['all'], 'only what the validator accepts is read' );
		$this->assertSame( '#wordsocket-prompts{--wordsocket-prompt-radius:4px;}', $style->css(), 'rendered again after the write' );
	}

	public function test_a_field_a_prompt_does_not_have_or_a_value_out_of_range_is_refused_naming_both(): void {
		$style = WPS::prompt_style();
		foreach (
			array(
				array( 'all', 'width', 400, 'width is for the modal and the panel' ),
				array( 'banner', 'overlay', '#000', 'the overlay is the modal\'s' ),
				array( 'modal', 'width', 4000, 'out of range' ),
				array( 'all', 'radius', '12px', 'a unit is not a number' ),
				array( 'all', 'background', 'red;}', 'not a hex or a slug' ),
				array( 'all', 'motion', 'bounce', 'not a motion' ),
				array( 'all', 'shadow', 'yes', 'not a boolean' ),
				array( 'all', 'unknown', 1, 'not a field' ),
			) as list( $scope, $field, $value, $why )
		) {
			$result = $style->validate( array( $scope => array( $field => $value ) ) );
			$this->assertInstanceOf( WP_Error::class, $result, $why );
			$this->assertSame( $scope, $result->get_error_data()['scope'], $why );
			$this->assertSame( $field, $result->get_error_data()['field'], $why );
		}
		$this->assertInstanceOf( WP_Error::class, $style->validate( array( 'popup' => array() ) ), 'not a prompt type' );
		$this->assertInstanceOf( WP_Error::class, $style->validate( 'all' ), 'not an object' );
	}

	public function test_the_route_needs_manage_options_and_saves_what_it_is_sent(): void {
		wp_set_current_user( 0 );
		list( $status ) = $this->rest( 'GET', 'prompt-style' );
		$this->assertSame( 401, $status );

		$this->as_admin();
		list( $status, $data ) = $this->rest( 'GET', 'prompt-style' );
		$this->assertSame( 200, $status );
		$this->assertSame( array( 'styles', 'fields', 'presets', 'sampleText', 'url', 'preview' ), array_keys( $data ) );
		$this->assertStringEndsWith( '?wordsocket-preview=', (string) $data['preview'], 'the suite runs in a non-production environment' );
		$this->assertArrayHasKey( 'palette', $data['presets'] );
		$this->assertSame( array( 'modal', 'panel' ), $data['fields']['width']['scopes'] );

		list( $status, $data ) = $this->rest( 'POST', 'prompt-style', array( 'styles' => array( 'all' => array( 'radius' => 0 ), 'bar' => array( 'close' => false ) ) ) );
		$this->assertSame( 200, $status );
		$this->assertSame( 0, $data['styles']['all']['radius'] );
		$this->assertSame( array( 'close' => false ), $data['styles']['bar'] );
		$this->assertSame( array(), $data['styles']['modal'], 'the defaults are not re-applied over a save that left them out' );

		list( $status, $data ) = $this->rest( 'POST', 'prompt-style', array( 'styles' => array( 'all' => array( 'width' => 300 ) ) ) );
		$this->assertSame( 400, $status );
		$this->assertSame( 'wpsignal_invalid_style', $data['code'] );
	}
}
