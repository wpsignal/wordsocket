import {
	SelectControl,
	TextControl,
	ComboboxControl,
	Button,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';

const OPTION_PRESETS = [
	{ value: 'blogname', label: 'Site Name (blogname)' },
	{ value: 'blogdescription', label: 'Site Description (blogdescription)' },
];

function autoEvent( trigger ) {
	if ( trigger.type === 'post_type' && trigger.post_type ) {
		return trigger.post_type + '.updated';
	}
	if ( trigger.type === 'option' && trigger.option_name ) {
		return 'option.' + trigger.option_name + '.updated';
	}
	return '';
}

export function TriggerRow( { trigger, index, postTypes, onChange, onRemove } ) {
	const update = ( field, value ) => {
		const next = { ...trigger, [ field ]: value };

		// Auto-generate event name when type target changes, unless user has customized it.
		if ( field === 'type' || field === 'post_type' || field === 'option_name' ) {
			const currentAuto = autoEvent( trigger );
			if ( ! trigger.event || trigger.event === currentAuto ) {
				next.event = autoEvent( next );
			}
		}

		onChange( index, next );
	};

	const typeOptions = [
		{ value: 'post_type', label: __( 'Post Type', 'wpsignal' ) },
		{ value: 'option', label: __( 'Option', 'wpsignal' ) },
	];

	return (
		<div className="wpsignal-trigger-row">
			<SelectControl
				label={ __( 'Type', 'wpsignal' ) }
				value={ trigger.type }
				options={ typeOptions }
				onChange={ ( val ) => update( 'type', val ) }
				__nextHasNoMarginBottom
			/>

			{ trigger.type === 'post_type' && (
				<SelectControl
					label={ __( 'Post Type', 'wpsignal' ) }
					value={ trigger.post_type }
					options={ [
						{ value: '', label: __( '-- Select --', 'wpsignal' ) },
						...postTypes,
					] }
					onChange={ ( val ) => update( 'post_type', val ) }
					__nextHasNoMarginBottom
				/>
			) }

			{ trigger.type === 'option' && (
				<ComboboxControl
					label={ __( 'Option Name', 'wpsignal' ) }
					value={ trigger.option_name }
					options={ OPTION_PRESETS }
					onChange={ ( val ) => update( 'option_name', val || '' ) }
					onFilterValueChange={ () => {} }
					allowReset={ false }
					__nextHasNoMarginBottom
				/>
			) }

			<TextControl
				label={ __( 'Channel', 'wpsignal' ) }
				value={ trigger.channel }
				onChange={ ( val ) => update( 'channel', val ) }
				__nextHasNoMarginBottom
			/>

			<TextControl
				label={ __( 'Event', 'wpsignal' ) }
				value={ trigger.event }
				onChange={ ( val ) => update( 'event', val ) }
				__nextHasNoMarginBottom
			/>

			<div className="wpsignal-trigger-actions">
				<Button
					variant="tertiary"
					isDestructive
					onClick={ () => onRemove( index ) }
				>
					{ __( 'Remove', 'wpsignal' ) }
				</Button>
			</div>
		</div>
	);
}
