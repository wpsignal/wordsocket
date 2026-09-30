/**
 * WordSocket stub extension: registers a panel in the Extensions tab and a
 * status line in the Connect tab. Plain JavaScript on the wp.* globals, no
 * build step; a real extension would use @wordpress/scripts and JSX.
 */
( function ( wp, wordsocket ) {
	const { registerPlugin } = wp.plugins;
	const { createElement: el } = wp.element;
	const { ExtensionPanel, ConnectionStatusFill, registerTab, useConnection, useClientState } = wordsocket;

	// A settings tab of its own, after WordSocket's built-in tabs (0.28).
	function Tab() {
		const connection = useConnection();
		return el(
			'div',
			{ className: 'stub-extension-tab' },
			el( 'h2', null, 'Stub Extension' ),
			el( 'p', null, 'Rendered as a tab through wordsocket.registerTab. Site ' + ( connection.isConnected ? 'connected' : 'not connected' ) + '.' )
		);
	}
	registerTab( { name: 'stub-extension', title: 'Stub', render: Tab } );

	function Panel() {
		const connection = useConnection();
		const client = useClientState();
		return el(
			wp.element.Fragment,
			null,
			el(
				ExtensionPanel,
				{
					name: 'wordsocket-stub-extension',
					title: 'Stub Extension',
					description: 'Rendered by a separate plugin through window.wordsocket.',
					docsUrl: 'https://wpsignal.io/docs/js-api',
				},
				el(
					'p',
					{ className: 'stub-extension-state' },
					'Site ' + ( connection.isConnected ? 'connected' : 'not connected' ) +
						', client ' + ( client && client.connected ? 'online' : 'offline' ) + '.'
				)
			),
			el( ConnectionStatusFill, null, el( 'p', { className: 'stub-extension-status' }, 'Stub extension is active.' ) )
		);
	}

	registerPlugin( 'wordsocket-stub-extension', { scope: 'wordsocket', render: Panel } );
} )( window.wp, window.wordsocket );
