import apiFetch from '@wordpress/api-fetch';
import type { Trigger } from './types';

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
