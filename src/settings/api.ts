/**
 * WordPress dependencies.
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies.
 */
import type { Trigger, Settings, ConnectResponse, SettingsPost } from './types';

/**
 * Types.
 */
interface TriggersResponse {
	triggers: Trigger[];
	message?: string;
}

/**
 * Get Triggers.
 * @returns Triggers response.
 */
export function getTriggers(): Promise< TriggersResponse > {
	return apiFetch( { path: '/wpsignal/v1/triggers' } );
}

/**
 * Save Triggers.
 * @param triggers - Triggers to save.
 * @returns Triggers response.
 */
export function saveTriggers( triggers: Trigger[] ): Promise< TriggersResponse > {
	return apiFetch( {
		path: '/wpsignal/v1/triggers',
		method: 'POST',
		data: { triggers },
	} );
}

/**
 * Get Settings.
 * @returns Settings response.
 */
export function getSettings(): Promise< Settings > {
	return apiFetch( { path: '/wpsignal/v1/settings' } );
}

/**
 * Save Settings.
 * @param settings - Settings to save.
 * @returns Settings response.
 */
export function saveSettings( settings: SettingsPost ): Promise< SettingsPost > {
	return apiFetch( {
		path: '/wpsignal/v1/settings',
		method: 'POST',
		data: settings,
	} );
}

/**
 * Connect with API Key.
 * @param api_key - API Key to connect with.
 * @returns Connect response.
 */
export function connectWithApiKey( api_key: string ): Promise< ConnectResponse > {
	return apiFetch( {
		path: '/wpsignal/v1/connect',
		method: 'POST',
		data: { api_key },
	} );
}

/**
 * Disconnect.
 * @returns Disconnect response.
 */
export function disconnect(): Promise< { ok: boolean } > {
	return apiFetch( {
		path: '/wpsignal/v1/disconnect',
		method: 'POST',
	} );
}

/**
 * Get a short-lived connection JWT for the current user.
 * @returns JWT response.
 */
export function getToken(): Promise< { token: string } > {
	return apiFetch( { path: '/wpsignal/v1/token' } );
}

/**
 * Publish a test event via the server-side proxy (keeps site secret out of the browser).
 */
export function publishEvent( channel: string, event: string, data: unknown ): Promise< { ok: boolean } > {
	return apiFetch( {
		path: '/wpsignal/v1/publish',
		method: 'POST',
		data: { channel, event, data },
	} );
}
