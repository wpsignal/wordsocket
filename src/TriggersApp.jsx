import { useState, useEffect } from '@wordpress/element';
import { Button, Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { TriggerRow } from './TriggerRow';
import { getTriggers, saveTriggers } from './api';

const EMPTY_TRIGGER = {
	type: 'post_type',
	post_type: '',
	option_name: '',
	channel: 'events',
	event: '',
};

export function TriggersApp() {
	const [ triggers, setTriggers ] = useState( [] );
	const [ saving, setSaving ] = useState( false );
	const [ notice, setNotice ] = useState( null );

	const postTypes = window.wpsignalTriggers?.postTypes || [];

	useEffect( () => {
		getTriggers()
			.then( ( res ) => {
				if ( res.triggers && res.triggers.length ) {
					setTriggers( res.triggers );
				}
			} )
			.catch( () => {
				setNotice( { type: 'error', message: __( 'Failed to load triggers.', 'wpsignal' ) } );
			} );
	}, [] );

	const addTrigger = () => {
		setTriggers( [ ...triggers, { ...EMPTY_TRIGGER } ] );
	};

	const updateTrigger = ( index, updated ) => {
		const next = [ ...triggers ];
		next[ index ] = updated;
		setTriggers( next );
	};

	const removeTrigger = ( index ) => {
		setTriggers( triggers.filter( ( _, i ) => i !== index ) );
	};

	const handleSave = async () => {
		setSaving( true );
		setNotice( null );

		try {
			const res = await saveTriggers( triggers );
			setTriggers( res.triggers );
			setNotice( { type: 'success', message: res.message } );
		} catch {
			setNotice( { type: 'error', message: __( 'Failed to save triggers.', 'wpsignal' ) } );
		} finally {
			setSaving( false );
		}
	};

	return (
		<div className="wpsignal-triggers-app">
			{ notice && (
				<Notice
					status={ notice.type }
					isDismissible
					onDismiss={ () => setNotice( null ) }
				>
					{ notice.message }
				</Notice>
			) }

			{ triggers.length === 0 && (
				<p>{ __( 'No custom triggers configured. Click "Add Trigger" to create one.', 'wpsignal' ) }</p>
			) }

			{ triggers.map( ( trigger, index ) => (
				<TriggerRow
					key={ index }
					trigger={ trigger }
					index={ index }
					postTypes={ postTypes }
					onChange={ updateTrigger }
					onRemove={ removeTrigger }
				/>
			) ) }

			<div className="wpsignal-triggers-footer">
				<Button variant="secondary" onClick={ addTrigger }>
					{ __( 'Add Trigger', 'wpsignal' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ handleSave }
					isBusy={ saving }
					disabled={ saving }
				>
					{ __( 'Save Triggers', 'wpsignal' ) }
				</Button>
			</div>
		</div>
	);
}
