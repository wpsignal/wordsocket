const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const path = require( 'path' );

module.exports = {
	...defaultConfig,
	entry: {
		client: path.resolve( __dirname, 'src/client.ts' ),
		settings: path.resolve( __dirname, 'src/settings/index.tsx' ),
		monitor: path.resolve( __dirname, 'src/monitor.ts' ),
	},
	output: {
		...defaultConfig.output,
		path: path.resolve( __dirname, 'build' ),
	},
};
