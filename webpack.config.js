const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const path = require( 'path' );

module.exports = {
	...defaultConfig,
	entry: {
		client: path.resolve( __dirname, 'src/client.ts' ),
		admin: path.resolve( __dirname, 'src/admin.ts' ),
		'kitchen-sink': path.resolve( __dirname, 'src/kitchen-sink.ts' ),
		triggers: path.resolve( __dirname, 'src/triggers/index.tsx' ),
	},
	output: {
		...defaultConfig.output,
		path: path.resolve( __dirname, 'build' ),
	},
};
