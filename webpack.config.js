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
	externals: {
		...defaultConfig.externals,
		'@wordpress/sync': 'wp.sync',
		'yjs': 'wp.sync.Y',
	},
};
