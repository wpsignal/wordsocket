import apiFetch from '@wordpress/api-fetch';

export function getTriggers() {
	return apiFetch( { path: '/wpsignal/v1/triggers' } );
}

export function saveTriggers( triggers ) {
	return apiFetch( {
		path: '/wpsignal/v1/triggers',
		method: 'POST',
		data: { triggers },
	} );
}
