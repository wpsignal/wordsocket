/**
 * WPSignal Admin — "Connect to WPSignal" button handler.
 */

const btn = document.getElementById( 'wpsignal-connect-btn' ) as HTMLButtonElement | null;
const status = document.getElementById( 'wpsignal-connect-status' );
const cfg = window.wpSignalAdmin;

if ( btn && status && cfg ) {
	btn.addEventListener( 'click', () => {
		btn.disabled = true;
		btn.textContent = 'Connecting\u2026';
		status.innerHTML = '';

		fetch( cfg.connectUrl, {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': cfg.nonce,
			},
		} )
			.then( ( res ) =>
				res.json().then( ( data: Record< string, string > ) => ( { ok: res.ok, data } ) )
			)
			.then( ( result ) => {
				if ( result.ok ) {
					const msg = result.data.message || 'Connected!';
					status.innerHTML = `<span style="color:#46b450;">${ msg }</span>`;
					setTimeout( () => location.reload(), 1200 );
				} else {
					const err = result.data.message || 'Unknown error';
					status.innerHTML = `<span style="color:#dc3232;">${ err }</span>`;
					btn.disabled = false;
					btn.textContent = 'Connect to WPSignal';
				}
			} )
			.catch( () => {
				status.innerHTML = '<span style="color:#dc3232;">Connection failed.</span>';
				btn.disabled = false;
				btn.textContent = 'Connect to WPSignal';
			} );
	} );
}
