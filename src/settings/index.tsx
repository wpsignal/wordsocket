import { createRoot } from '@wordpress/element';
import { SettingsApp } from './AppSettings';
import './index.css';

const root = document.getElementById( 'wpsignal-settings-root' );
if ( root ) {
	createRoot( root ).render( <SettingsApp /> );
}
