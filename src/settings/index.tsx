import { createRoot } from '@wordpress/element';
import { SettingsApp } from './AppSettings';
import { installExtensionsApi } from './extensions/api';
import './index.css';

// Before anything renders: extension scripts run right after this bundle.
installExtensionsApi();

const root = document.getElementById( 'wpsignal-settings-root' );
if ( root ) {
	createRoot( root ).render( <SettingsApp /> );
}
