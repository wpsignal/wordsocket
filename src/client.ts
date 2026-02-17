/**
 * WPSignal Client
 *
 * Prefers WebSocket for bidirectional communication, falls back to SSE.
 * Dispatches `wpsignal:<event>` DOM custom events regardless of transport.
 *
 * Exposes `window.WPS` — the public JS API — so any theme or plugin can
 * subscribe/unsubscribe channels, publish messages, and listen for events
 * on the shared connection. Enqueue with `'wpsignal'` as a script dependency.
 */

const config = window.wpSignalConfig;
if ( config?.baseUrl && config?.restUrl ) {
	const baseUrl = config.baseUrl.replace( /\/+$/, '' );

	let transport: 'ws' | 'sse' | null = null;
	let ws: WebSocket | null = null;
	let sseReader: EventSource | null = null;
	let refreshTimer: ReturnType< typeof setTimeout > | null = null;
	let connected = false;

	// --- Public API registries ---
	const messageHandlers = new Set< WPSMessageHandler >();
	const eventHandlers = new Map< string, Set< WPSEventHandler > >();
	const connectionChangeHandlers = new Set< ( c: boolean ) => void >();
	/** Channels requested by external consumers (queued until WS is open). */
	const pendingSubscriptions: string[] = [];

	function setConnected( value: boolean ): void {
		connected = value;
		connectionChangeHandlers.forEach( ( fn ) => fn( value ) );
	}

	function fetchToken(): Promise< { token: string; channels: string[]; exp: number } > {
		return fetch( config!.restUrl, {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': config!.nonce,
			},
		} ).then( ( res ) => {
			if ( ! res.ok ) {
				throw new Error( `WPSignal: token request failed (${ res.status })` );
			}
			return res.json();
		} );
	}

	function dispatchEvent( eventName: string, channel: string, data: Record< string, unknown > ): void {
		console.log( `[WPSignal] ${ eventName }`, data );
		document.dispatchEvent(
			new CustomEvent( `wpsignal:${ eventName }`, {
				detail: { channel, data },
			} )
		);
		// Notify catch-all message handlers.
		messageHandlers.forEach( ( fn ) => fn( eventName, data, channel ) );
		// Notify event-specific handlers.
		eventHandlers.get( eventName )?.forEach( ( fn ) => fn( data, channel ) );
	}

	function scheduleRefresh( exp: number ): void {
		if ( refreshTimer ) {
			clearTimeout( refreshTimer );
		}
		const ttl = ( exp - Math.floor( Date.now() / 1000 ) ) * 1000;
		const refreshAt = Math.max( ttl * 0.8, 10000 );

		refreshTimer = setTimeout( () => {
			console.log( '[WPSignal] Refreshing token...' );
			fetchToken()
				.then( ( data ) => {
					if ( transport === 'ws' && ws?.readyState === WebSocket.OPEN ) {
						ws.send( JSON.stringify( { type: 'auth', token: data.token } ) );
					} else {
						cleanup();
						init();
					}
					scheduleRefresh( data.exp );
				} )
				.catch( ( err ) => {
					console.error( '[WPSignal] Token refresh failed', err );
					setTimeout( () => { cleanup(); init(); }, 5000 );
				} );
		}, refreshAt );
	}

	function flushPendingSubscriptions(): void {
		if ( pendingSubscriptions.length && ws?.readyState === WebSocket.OPEN ) {
			ws.send( JSON.stringify( { type: 'subscribe', channels: pendingSubscriptions.splice( 0 ) } ) );
		}
	}

	function connectWebSocket( token: string, channels: string[] ): void {
		const wsProto = baseUrl.startsWith( 'https' ) ? 'wss' : 'ws';
		const wsHost = baseUrl.replace( /^https?:\/\//, '' );
		const wsUrl = `${ wsProto }://${ wsHost }/ws?token=${ encodeURIComponent( token ) }`;

		let didFallback = false;
		let didOpen = false;

		function fallbackToSSE(): void {
			if ( didFallback ) return;
			didFallback = true;
			ws = null;
			console.log( '[WPSignal] Falling back to SSE' );
			connectSSE( token, channels );
		}

		ws = new WebSocket( wsUrl );
		transport = 'ws';

		ws.addEventListener( 'open', () => {
			didOpen = true;
			setConnected( true );
			console.log( '[WPSignal] WebSocket connected' );
			ws!.send( JSON.stringify( { type: 'subscribe', channels } ) );
			flushPendingSubscriptions();
		} );

		ws.addEventListener( 'message', ( e: MessageEvent ) => {
			try {
				const msg = JSON.parse( e.data );
				switch ( msg.type ) {
					case 'message':
						dispatchEvent( msg.event, msg.channel, msg.data ?? {} );
						break;
					case 'ping':
						ws!.send( JSON.stringify( { type: 'pong' } ) );
						break;
					case 'subscribed':
						console.log( '[WPSignal] Subscribed to', msg.channels );
						break;
					case 'unsubscribed':
						console.log( '[WPSignal] Unsubscribed from', msg.channels );
						break;
					case 'auth_ok':
						console.log(
							'[WPSignal] Auth refreshed, expires at',
							new Date( msg.exp * 1000 ).toISOString()
						);
						break;
					case 'error':
						console.warn( '[WPSignal] Server error:', msg.code, msg.message );
						break;
				}
			} catch ( err ) {
				console.warn( '[WPSignal] Failed to parse WS message', err );
			}
		} );

		ws.addEventListener( 'close', ( e: CloseEvent ) => {
			console.log( `[WPSignal] WebSocket closed (code=${ e.code })` );
			ws = null;
			setConnected( false );
			if ( ! didOpen ) {
				fallbackToSSE();
			} else {
				console.log( '[WPSignal] Reconnecting in 5s...' );
				setTimeout( () => { cleanup(); init(); }, 5000 );
			}
		} );

		ws.addEventListener( 'error', () => {
			console.warn( '[WPSignal] WebSocket error' );
		} );
	}

	function connectSSE( token: string, channels: string[] ): void {
		transport = 'sse';
		setConnected( true );
		const url = `${ baseUrl }/sse?token=${ encodeURIComponent( token ) }&channels=${ encodeURIComponent( channels.join( ',' ) ) }`;
		const source = new EventSource( url );
		sseReader = source;

		source.addEventListener( 'open', () => {
			console.log( '[WPSignal] SSE connected' );
		} );

		source.addEventListener( 'error', ( e ) => {
			console.warn( '[WPSignal] SSE error', e );
		} );

		const eventTypes = [ 'post.updated', 'post.created', 'post.deleted', 'comment.created' ];
		eventTypes.forEach( ( eventType ) => {
			source.addEventListener( eventType, ( e: Event ) => {
				try {
					const payload = JSON.parse( ( e as MessageEvent ).data );
					dispatchEvent( eventType, '', payload );
				} catch ( err ) {
					console.warn( '[WPSignal] Failed to parse SSE data', err );
				}
			} );
		} );

		source.addEventListener( 'message', ( e: MessageEvent ) => {
			console.log( '[WPSignal] SSE message', e.data );
		} );
	}

	function cleanup(): void {
		if ( refreshTimer ) {
			clearTimeout( refreshTimer );
			refreshTimer = null;
		}
		if ( ws ) {
			ws.close();
			ws = null;
		}
		if ( sseReader ) {
			sseReader.close();
			sseReader = null;
		}
		transport = null;
		setConnected( false );
	}

	function init(): void {
		fetchToken()
			.then( ( data ) => {
				console.log(
					'[WPSignal] Token obtained, expires at',
					new Date( data.exp * 1000 ).toISOString()
				);
				scheduleRefresh( data.exp );

				if ( typeof WebSocket !== 'undefined' ) {
					connectWebSocket( data.token, data.channels );
				} else {
					connectSSE( data.token, data.channels );
				}
			} )
			.catch( ( err ) => {
				console.error( '[WPSignal]', err );
				setTimeout( init, 30000 );
			} );
	}

	// --- Expose public API on window.WPS ---
	window.WPS = {
		subscribe( channels: string[] ): void {
			if ( ws?.readyState === WebSocket.OPEN ) {
				ws.send( JSON.stringify( { type: 'subscribe', channels } ) );
			} else {
				pendingSubscriptions.push( ...channels );
			}
		},

		unsubscribe( channels: string[] ): void {
			if ( ws?.readyState === WebSocket.OPEN ) {
				ws.send( JSON.stringify( { type: 'unsubscribe', channels } ) );
			} else {
				// Remove from pending queue if not yet sent.
				for ( const ch of channels ) {
					const idx = pendingSubscriptions.indexOf( ch );
					if ( idx !== -1 ) {
						pendingSubscriptions.splice( idx, 1 );
					}
				}
			}
		},

		publish( channel: string, event: string, data: Record< string, unknown > = {} ): void {
			if ( transport === 'sse' ) {
				console.warn( '[WPSignal] publish() is not supported on SSE (one-way transport).' );
				return;
			}
			if ( ws?.readyState === WebSocket.OPEN ) {
				ws.send( JSON.stringify( { type: 'message', channel, event, data } ) );
			}
		},

		on( event: string, handler: WPSEventHandler ): () => void {
			let handlers = eventHandlers.get( event );
			if ( ! handlers ) {
				handlers = new Set();
				eventHandlers.set( event, handlers );
			}
			handlers.add( handler );
			return () => {
				handlers!.delete( handler );
				if ( handlers!.size === 0 ) {
					eventHandlers.delete( event );
				}
			};
		},

		onMessage( handler: WPSMessageHandler ): () => void {
			messageHandlers.add( handler );
			return () => { messageHandlers.delete( handler ); };
		},

		get connected(): boolean {
			return connected;
		},

		onConnectionChange( handler: ( c: boolean ) => void ): () => void {
			connectionChangeHandlers.add( handler );
			return () => { connectionChangeHandlers.delete( handler ); };
		},
	};

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
}
