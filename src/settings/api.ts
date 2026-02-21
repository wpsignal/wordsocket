import apiFetch from '@wordpress/api-fetch';
import type { Trigger, Settings, ConnectResponse } from './types';

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

export function saveSettings( data: { base_url: string; api_key: string; yjs_provider_enabled?: boolean } ): Promise< Settings > {
	return apiFetch( {
		path: '/wpsignal/v1/settings',
		method: 'POST',
		data,
	} );
}

export function connect(): Promise< ConnectResponse > {
	return apiFetch( {
		path: '/wpsignal/v1/connect',
		method: 'POST',
	} );
}
