import { useState, useEffect } from '@wordpress/element';
import { TextControl, Button, Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { getSettings, saveSettings, connect } from './api';
import type { Settings } from './types';

interface NoticeState {
	type: 'success' | 'error';
	message: string;
}

export function ConnectionTab() {
	const [ baseUrl, setBaseUrl ] = useState( '' );
	const [ apiKey, setApiKey ] = useState( '' );
	const [ siteKey, setSiteKey ] = useState( '' );
	const [ isConnected, setIsConnected ] = useState( false );
	const [ saving, setSaving ] = useState( false );
	const [ connecting, setConnecting ] = useState( false );
	const [ notice, setNotice ] = useState< NoticeState | null >( null );

	useEffect( () => {
		getSettings()
			.then( ( res: Settings ) => {
				setBaseUrl( res.base_url );
				setApiKey( res.api_key );
				setSiteKey( res.site_key );
				setIsConnected( res.is_connected );
			} )
			.catch( () => {
				setNotice( { type: 'error', message: __( 'Failed to load settings.', 'signal-realtime' ) } );
			} );
	}, [] );

	const handleSave = async (): Promise< void > => {
		setSaving( true );
		setNotice( null );
		try {
			const res = await saveSettings( { base_url: baseUrl, api_key: apiKey } );
			setSiteKey( res.site_key );
			setIsConnected( res.is_connected );
			setNotice( { type: 'success', message: __( 'Settings saved.', 'signal-realtime' ) } );
		} catch {
			setNotice( { type: 'error', message: __( 'Failed to save settings.', 'signal-realtime' ) } );
		} finally {
			setSaving( false );
		}
	};

	const handleConnect = async (): Promise< void > => {
		setConnecting( true );
		setNotice( null );
		try {
			// Persist current form values before connecting so handle_connect
			// reads the up-to-date base_url and api_key from wp_options.
			await saveSettings( { base_url: baseUrl, api_key: apiKey } );
			const res = await connect();
			setSiteKey( res.site_key );
			setIsConnected( true );
			setNotice( { type: 'success', message: res.message || __( 'Connected!', 'signal-realtime' ) } );
		} catch ( error: any ) {
			setNotice( { type: 'error', message: error?.message || __( 'Connection failed. Make sure your Server URL and API Key are saved.', 'signal-realtime' ) } );
		} finally {
			setConnecting( false );
		}
	};

	return (
		<div className="wpsignal-connection-tab">
			{ notice && (
				<Notice
					status={ notice.type }
					isDismissible
					onDismiss={ () => setNotice( null ) }
				>
					{ notice.message }
				</Notice>
			) }

			<div className="wpsignal-connection-status">
				{ isConnected ? (
					<p>
						<span className="wpsignal-status-connected">&#10003; { __( 'Connected', 'signal-realtime' ) }</span>
						{ siteKey && <> &mdash; <code>{ siteKey }</code></> }
					</p>
				) : (
					<p>
						<span className="wpsignal-status-disconnected">&#10005; { __( 'Not connected', 'signal-realtime' ) }</span>
					</p>
				) }
			</div>

			<TextControl
				label={ __( 'Server URL', 'signal-realtime' ) }
				value={ baseUrl }
				onChange={ setBaseUrl }
				placeholder="https://api.wpsignal.io"
				help={ __( 'The wpsignal.io service URL.', 'signal-realtime' ) }
				__nextHasNoMarginBottom
			/>

			<TextControl
				label={ __( 'API Key', 'signal-realtime' ) }
				value={ apiKey }
				onChange={ setApiKey }
				type="password"
				help={ __( 'Get your API key from your wpsignal.io dashboard.', 'signal-realtime' ) }
				__nextHasNoMarginBottom
			/>

			<div className="wpsignal-connection-actions">
				<Button
					variant="primary"
					onClick={ handleSave }
					isBusy={ saving }
					disabled={ saving || connecting }
				>
					{ __( 'Save Settings', 'signal-realtime' ) }
				</Button>
				<Button
					variant="secondary"
					onClick={ handleConnect }
					isBusy={ connecting }
					disabled={ saving || connecting }
				>
					{ __( 'Connect to WPSignal', 'signal-realtime' ) }
				</Button>
			</div>
		</div>
	);
}
