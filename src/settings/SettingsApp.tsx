import { TabPanel } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { ConnectionTab } from './ConnectionTab';
import { TriggersApp } from './TriggersApp';

const TABS = [
	{
		name: 'connection',
		title: __( 'Connection', 'wpsignal' ),
		className: 'wpsignal-tab-connection',
	},
	{
		name: 'triggers',
		title: __( 'Triggers', 'wpsignal' ),
		className: 'wpsignal-tab-triggers',
	},
];

export function SettingsApp() {
	return (
		<TabPanel tabs={ TABS }>
			{ ( tab ) => (
				<div className="wpsignal-tab-content">
					{ tab.name === 'connection' && <ConnectionTab /> }
					{ tab.name === 'triggers' && <TriggersApp /> }
				</div>
			) }
		</TabPanel>
	);
}
