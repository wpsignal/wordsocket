import apiFetch from '@wordpress/api-fetch';
import type { Trigger, Settings, ConnectResponse, SettingsPost } from './types';

interface TriggersResponse {
	triggers: Trigger[];
	message?: string;
}

export function getTriggers(): Promise< TriggersResponse > {
	return apiFetch( { path: '/wpsignal/v1/triggers' } );
}

export function saveTriggers( triggers: Trigger[] ): Promise< TriggersResponse > {
	return apiFetch( {
		path: '/wpsignal/v1/triggers',
		method: 'POST',
		data: { triggers },
	} );
}

export function getSettings(): Promise< Settings > {
	return apiFetch( { path: '/wpsignal/v1/settings' } );
}

export function saveSettings( settings: SettingsPost ): Promise< SettingsPost > {
	return apiFetch( {
		path: '/wpsignal/v1/settings',
		method: 'POST',
		data: settings,
	} );
}

export function connect( api_key: string ): Promise< ConnectResponse > {
	return apiFetch( {
		path: '/wpsignal/v1/connect',
		method: 'POST',
		data: { api_key },
	} );
}

export function disconnect(): Promise< { ok: boolean } > {
	return apiFetch( {
		path: '/wpsignal/v1/disconnect',
		method: 'POST',
	} );
}

export function getToken(): Promise< { token: string } > {
	return apiFetch( { path: '/wpsignal/v1/token' } );
}
