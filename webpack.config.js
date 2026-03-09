const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const path = require( 'path' );

module.exports = {
	...defaultConfig,
	entry: {
		client: path.resolve( __dirname, 'src/client.ts' ),
		settings: path.resolve( __dirname, 'src/settings/index.tsx' ),
		explorer: path.resolve( __dirname, 'src/explorer.ts' ),
		'yjs-provider': path.resolve( __dirname, 'src/yjs-provider-boot.ts' ),
	},
	output: {
		...defaultConfig.output,
		path: path.resolve( __dirname, 'build' ),
	},
	externals: {
		...defaultConfig.externals,
		'@wordpress/sync': 'wp.sync',
	},
};
