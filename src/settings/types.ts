export interface Trigger {
	type: 'post_type' | 'option';
	post_type: string;
	option_name: string;
	channel: string;
	event: string;
}

export interface PostTypeOption {
	value: string;
	label: string;
}

export interface Settings {
	// base_url: string;
	api_key: string;
	site_key: string;
	is_connected: boolean;
	yjs_provider_enabled: boolean;
	is_rtc_enabled: boolean;
	wp_version: number;
	credential_source?: 'constant' | 'database';
}

export interface ConnectResponse {
	message: string;
	site_key: string;
}
