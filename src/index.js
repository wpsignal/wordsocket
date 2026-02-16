import { createRoot } from '@wordpress/element';
import { TriggersApp } from './TriggersApp';
import './index.css';

const root = document.getElementById( 'wpsignal-triggers-root' );

if ( root ) {
	createRoot( root ).render( <TriggersApp /> );
}
