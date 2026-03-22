import { TabPanel } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { ConnectionTab } from './ConnectionTab';
import { TriggersTab } from './TriggersTab';

const TABS = [
	{
		name: 'connection',
		title: __( 'Connection', 'wordsocket' ),
		className: 'wpsignal-tab-connection',
	},
	{
		name: 'triggers',
		title: __( 'Triggers', 'wordsocket' ),
		className: 'wpsignal-tab-triggers',
	},
];

export function SettingsApp() {
	return (
		<TabPanel className="wpsignal-settings-app" tabs={ TABS }>
			{ ( tab ) => (
				<div className="wpsignal-tab-content">
					{ tab.name === 'connection' && <ConnectionTab /> }
					{ tab.name === 'triggers' && <TriggersTab /> }
				</div>
			) }
		</TabPanel>
	);
}
