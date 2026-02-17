const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const path = require( 'path' );

module.exports = {
	...defaultConfig,
	entry: {
		client: path.resolve( __dirname, 'src/client.ts' ),
		settings: path.resolve( __dirname, 'src/settings/index.tsx' ),
		'kitchen-sink': path.resolve( __dirname, 'src/kitchen-sink.ts' ),
	},
	output: {
		...defaultConfig.output,
		path: path.resolve( __dirname, 'build' ),
	},
};
