import {
	SelectControl,
	TextControl,
	ComboboxControl,
	Button,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import type { Trigger, PostTypeOption } from './types';

const OPTION_PRESETS = [
	{ value: 'blogname', label: 'Site Name (blogname)' },
	{ value: 'blogdescription', label: 'Site Description (blogdescription)' },
];

function autoEvent( trigger: Trigger ): string {
	if ( trigger.type === 'post_type' && trigger.post_type ) {
		return trigger.post_type + '.updated';
	}
	if ( trigger.type === 'option' && trigger.option_name ) {
		return 'option.' + trigger.option_name + '.updated';
	}
	return '';
}

interface Props {
	trigger: Trigger;
	index: number;
	postTypes: PostTypeOption[];
	onChange: ( index: number, updated: Trigger ) => void;
	onRemove: ( index: number ) => void;
}

export function TriggerRow( { trigger, index, postTypes, onChange, onRemove }: Props ) {
	const update = ( field: keyof Trigger, value: string ): void => {
		const next = { ...trigger, [ field ]: value };

		if ( field === 'type' || field === 'post_type' || field === 'option_name' ) {
			const currentAuto = autoEvent( trigger );
			if ( ! trigger.event || trigger.event === currentAuto ) {
				next.event = autoEvent( next );
			}
		}

		onChange( index, next );
	};

	const typeOptions = [
		{ value: 'post_type', label: __( 'Post Type', 'eventa-for-wpsignal' ) },
		{ value: 'option', label: __( 'Option', 'eventa-for-wpsignal' ) },
	];

	return (
		<div className="wpsignal-trigger-row">
			<SelectControl
				label={ __( 'Type', 'eventa-for-wpsignal' ) }
				value={ trigger.type }
				options={ typeOptions }
				onChange={ ( val ) => update( 'type', val ) }
				__nextHasNoMarginBottom
			/>

			{ trigger.type === 'post_type' && (
				<SelectControl
					label={ __( 'Post Type', 'eventa-for-wpsignal' ) }
					value={ trigger.post_type }
					options={ [
						{ value: '', label: __( '-- Select --', 'eventa-for-wpsignal' ) },
						...postTypes,
					] }
					onChange={ ( val ) => update( 'post_type', val ) }
					__nextHasNoMarginBottom
				/>
			) }

			{ trigger.type === 'option' && (
				<ComboboxControl
					label={ __( 'Option Name', 'eventa-for-wpsignal' ) }
					value={ trigger.option_name }
					options={ OPTION_PRESETS }
					onChange={ ( val ) => update( 'option_name', val || '' ) }
					onFilterValueChange={ () => {} }
					allowReset={ false }
					__nextHasNoMarginBottom
				/>
			) }

			<TextControl
				label={ __( 'Channel', 'eventa-for-wpsignal' ) }
				value={ trigger.channel }
				onChange={ ( val ) => update( 'channel', val ) }
				__nextHasNoMarginBottom
			/>

			<TextControl
				label={ __( 'Event', 'eventa-for-wpsignal' ) }
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
					{ __( 'Remove', 'eventa-for-wpsignal' ) }
				</Button>
			</div>
		</div>
	);
}
