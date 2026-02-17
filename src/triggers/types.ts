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
