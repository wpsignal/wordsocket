import { createRoot } from '@wordpress/element';
import { SettingsApp } from './SettingsApp';
import './index.css';

const root = document.getElementById( 'wpsignal-settings-root' );
if ( root ) {
	createRoot( root ).render( <SettingsApp /> );
}
