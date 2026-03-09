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

export function saveSettings( data: { api_key: string; yjs_provider_enabled?: boolean; wp_version?: string } ): Promise< Settings > {
	return apiFetch( {
		path: '/wpsignal/v1/settings',
		method: 'POST',
		data,
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
