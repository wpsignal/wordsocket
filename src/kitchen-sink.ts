/**
 * WPSignal Kitchen Sink — interactive admin demo page.
 */

const cfg = window.wpSignalKitchenSink;
if ( cfg ) {
	let ws: WebSocket | null = null;
	let expiryInterval: ReturnType< typeof setInterval > | null = null;

	// -- Helpers --

	function $( id: string ): HTMLElement | null {
		return document.getElementById( id );
	}

	function appendLog( text: string, color?: string ): void {
		const log = $( 'wpsignal-ks-event-log' );
		if ( ! log ) return;
		const line = document.createElement( 'div' );
		line.style.color = color || '#c3c4c7';
		line.textContent = new Date().toLocaleTimeString() + '  ' + text;
		log.appendChild( line );
		log.scrollTop = log.scrollHeight;
	}

	function clearLog(): void {
		const log = $( 'wpsignal-ks-event-log' );
		if ( log ) log.innerHTML = '';
	}

	function restPost( url: string, body?: Record< string, unknown > ): Promise< Response > {
		return fetch( url, {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': cfg!.nonce,
			},
			body: body ? JSON.stringify( body ) : undefined,
		} );
	}

	// -- 1. Test Connection --

	const testBtn = $( 'wpsignal-ks-test-connection' );
	const testStatus = $( 'wpsignal-ks-test-status' );

	if ( testBtn && testStatus ) {
		testBtn.addEventListener( 'click', () => {
			testStatus.textContent = 'Testing...';
			testStatus.style.color = '';

			const url = cfg!.baseUrl.replace( /\/+$/, '' ) + '/healthz';
			fetch( url )
				.then( ( res ) => {
					if ( ! res.ok ) throw new Error( `HTTP ${ res.status }` );
					return res.json();
				} )
				.then( ( data: { active_connections: number; published_messages: number } ) => {
					testStatus.style.color = '#46b450';
					testStatus.textContent = `OK — ${ data.active_connections } connections, ${ data.published_messages } published`;
				} )
				.catch( ( err: Error ) => {
					testStatus.style.color = '#dc3232';
					testStatus.textContent = `Failed: ${ err.message }`;
				} );
		} );
	}

	// -- 3. Live Event Log (WebSocket) --

	const connectBtn = $( 'wpsignal-ks-connect' ) as HTMLButtonElement | null;
	const disconnectBtn = $( 'wpsignal-ks-disconnect' ) as HTMLButtonElement | null;
	const wsStatus = $( 'wpsignal-ks-ws-status' );

	function setWsStatus( text: string, color?: string ): void {
		if ( wsStatus ) {
			wsStatus.textContent = text;
			wsStatus.style.color = color || '';
		}
	}

	function connectWs(): void {
		if ( ! cfg!.configured ) {
			setWsStatus( 'Not configured', '#dc3232' );
			return;
		}

		const channelsInput = $( 'wpsignal-ks-channels' ) as HTMLInputElement | null;
		const channels = channelsInput?.value || 'events';
		clearLog();
		appendLog( 'Fetching token...', '#72aee6' );

		restPost( cfg!.tokenUrl )
			.then( ( res ) => {
				if ( ! res.ok ) throw new Error( `Token request failed: HTTP ${ res.status }` );
				return res.json();
			} )
			.then( ( data: { token: string } ) => {
				const token = data.token;
				const base = cfg!.baseUrl.replace( /\/+$/, '' );
				const wsProto = base.startsWith( 'https' ) ? 'wss' : 'ws';
				const wsHost = base.replace( /^https?:\/\//, '' );
				const wsUrl = `${ wsProto }://${ wsHost }/ws?token=${ encodeURIComponent( token ) }`;

				appendLog( 'Connecting to WebSocket...', '#72aee6' );
				ws = new WebSocket( wsUrl );

				ws.addEventListener( 'open', () => {
					setWsStatus( 'Connected', '#46b450' );
					appendLog( 'Connected', '#46b450' );
					if ( connectBtn ) connectBtn.disabled = true;
					if ( disconnectBtn ) disconnectBtn.disabled = false;

					const channelList = channels.split( ',' ).map( ( c ) => c.trim() );
					ws!.send( JSON.stringify( { type: 'subscribe', channels: channelList } ) );
					appendLog( `Subscribing to: ${ channelList.join( ', ' ) }`, '#72aee6' );
				} );

				ws.addEventListener( 'message', ( e: MessageEvent ) => {
					try {
						const msg = JSON.parse( e.data );
						switch ( msg.type ) {
							case 'message':
								appendLog(
									`[${ msg.channel }] ${ msg.event }: ${ JSON.stringify( msg.data ) }`,
									'#00e676'
								);
								break;
							case 'subscribed':
								appendLog( `Subscribed to: ${ ( msg.channels || [] ).join( ', ' ) }`, '#72aee6' );
								break;
							case 'unsubscribed':
								appendLog( `Unsubscribed from: ${ ( msg.channels || [] ).join( ', ' ) }`, '#ffb74d' );
								break;
							case 'ping':
								ws!.send( JSON.stringify( { type: 'pong' } ) );
								break;
							case 'error':
								appendLog( `Error: ${ msg.code } — ${ msg.message }`, '#dc3232' );
								break;
							default:
								appendLog( JSON.stringify( msg ), '#c3c4c7' );
						}
					} catch ( err ) {
						appendLog( `Parse error: ${ ( err as Error ).message }`, '#dc3232' );
					}
				} );

				ws.addEventListener( 'close', ( e: CloseEvent ) => {
					setWsStatus( `Disconnected (code=${ e.code })`, '#dc3232' );
					appendLog( `Disconnected (code=${ e.code })`, '#ffb74d' );
					if ( connectBtn ) connectBtn.disabled = false;
					if ( disconnectBtn ) disconnectBtn.disabled = true;
					ws = null;
				} );

				ws.addEventListener( 'error', () => {
					appendLog( 'WebSocket error', '#dc3232' );
				} );
			} )
			.catch( ( err: Error ) => {
				setWsStatus( 'Error', '#dc3232' );
				appendLog( `Error: ${ err.message }`, '#dc3232' );
			} );
	}

	function disconnectWs(): void {
		if ( ws ) {
			ws.close();
			ws = null;
		}
	}

	if ( connectBtn ) connectBtn.addEventListener( 'click', connectWs );
	if ( disconnectBtn ) disconnectBtn.addEventListener( 'click', disconnectWs );

	// -- 4. Publish Test Event --

	const publishBtn = $( 'wpsignal-ks-publish' );
	const pubStatus = $( 'wpsignal-ks-pub-status' );

	if ( publishBtn && pubStatus ) {
		publishBtn.addEventListener( 'click', () => {
			const channelEl = $( 'wpsignal-ks-pub-channel' ) as HTMLInputElement | null;
			const eventEl = $( 'wpsignal-ks-pub-event' ) as HTMLInputElement | null;
			const dataEl = $( 'wpsignal-ks-pub-data' ) as HTMLTextAreaElement | null;

			const channel = channelEl?.value || 'events';
			const event = eventEl?.value || 'test.event';
			const dataStr = dataEl?.value || '{}';

			let data: unknown;
			try {
				data = JSON.parse( dataStr );
			} catch ( err ) {
				pubStatus.textContent = `Invalid JSON: ${ ( err as Error ).message }`;
				pubStatus.style.color = '#dc3232';
				return;
			}

			pubStatus.textContent = 'Publishing...';
			pubStatus.style.color = '';

			restPost( cfg!.publishUrl, { channel, event, data } )
				.then( ( res ) => {
					if ( ! res.ok ) throw new Error( `HTTP ${ res.status }` );
					return res.json();
				} )
				.then( () => {
					pubStatus.textContent = 'Published!';
					pubStatus.style.color = '#46b450';
				} )
				.catch( ( err: Error ) => {
					pubStatus.textContent = `Failed: ${ err.message }`;
					pubStatus.style.color = '#dc3232';
				} );
		} );
	}

	// -- 5. Token Inspector --

	const mintBtn = $( 'wpsignal-ks-mint-token' );

	if ( mintBtn ) {
		mintBtn.addEventListener( 'click', () => {
			restPost( cfg!.tokenUrl )
				.then( ( res ) => {
					if ( ! res.ok ) throw new Error( `HTTP ${ res.status }` );
					return res.json();
				} )
				.then( ( data: { token: string } ) => {
					const display = $( 'wpsignal-ks-token-display' ) as HTMLElement | null;
					const rawEl = $( 'wpsignal-ks-token-raw' ) as HTMLTextAreaElement | null;
					const claimsEl = $( 'wpsignal-ks-token-claims' );
					const expiryEl = $( 'wpsignal-ks-token-expiry' );

					if ( display ) display.style.display = 'block';
					if ( rawEl ) rawEl.value = data.token;

					try {
						const parts = data.token.split( '.' );
						const payload = JSON.parse( atob( parts[ 1 ].replace( /-/g, '+' ).replace( /_/g, '/' ) ) );
						if ( claimsEl ) claimsEl.textContent = JSON.stringify( payload, null, 2 );

						if ( expiryInterval ) clearInterval( expiryInterval );
						function updateExpiry(): void {
							const remaining = payload.exp - Math.floor( Date.now() / 1000 );
							if ( expiryEl ) {
								if ( remaining > 0 ) {
									const mins = Math.floor( remaining / 60 );
									const secs = remaining % 60;
									expiryEl.textContent = `Expires in: ${ mins }m ${ secs }s`;
									expiryEl.style.color = remaining < 60 ? '#dc3232' : '#46b450';
								} else {
									expiryEl.textContent = 'Expired';
									expiryEl.style.color = '#dc3232';
									if ( expiryInterval ) clearInterval( expiryInterval );
								}
							}
						}
						updateExpiry();
						expiryInterval = setInterval( updateExpiry, 1000 );
					} catch ( err ) {
						if ( claimsEl ) claimsEl.textContent = `Failed to decode: ${ ( err as Error ).message }`;
					}
				} )
				.catch( ( err: Error ) => {
					const display = $( 'wpsignal-ks-token-display' ) as HTMLElement | null;
					if ( display ) display.style.display = 'block';
					const claimsEl = $( 'wpsignal-ks-token-claims' );
					if ( claimsEl ) claimsEl.textContent = `Error: ${ err.message }`;
				} );
		} );
	}
}
