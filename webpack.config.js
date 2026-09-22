const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const path = require( 'path' );

module.exports = {
	...defaultConfig,
	entry: {
		client: path.resolve( __dirname, 'src/client.ts' ),
		settings: path.resolve( __dirname, 'src/settings/index.tsx' ),
		'yjs-provider': path.resolve( __dirname, 'src/yjs-provider-boot.ts' ),
	},
	output: {
		...defaultConfig.output,
		path: path.resolve( __dirname, 'build' ),
	},
	resolve: {
		...defaultConfig.resolve,
		alias: {
			...defaultConfig.resolve?.alias,
			/*
			 * The bundled y-protocols imports `yjs`; point it at the editor's instance (held in src/yjs-runtime.ts) rather than a second copy
			 * of Yjs, which would share no class identities and sync nothing.  It used to be the `wp.sync.Y` global, which Gutenberg is
			 * removing (WordPress/gutenberg#81999).
			 */
			yjs: path.resolve( __dirname, 'src/yjs-runtime.ts' ),
		},
	},
};
