const defaultConfig = require("@wordpress/scripts/config/webpack.config");
const DependencyExtractionWebpackPlugin = require("@wordpress/dependency-extraction-webpack-plugin");
const path = require("path");

/*
 * Two compilations over one `build/`: the settings entry bundles `@wordpress/ui`,
 * `@wordpress/theme` and `@wordpress/private-apis` together (they unlock each other, and `wp-theme`
 * exists only from WordPress 7), while the client entries keep core's `wp-private-apis` for the Yjs
 * provider. Each cleans `build/` but keeps the other's files.
 */
const SETTINGS_BUNDLED = new Set([
  "@wordpress/theme",
  "@wordpress/private-apis",
]);

const base = {
  ...defaultConfig,
  resolve: {
    ...defaultConfig.resolve,
    alias: {
      ...defaultConfig.resolve?.alias,
      /*
       * The bundled y-protocols imports `yjs`; point it at the editor's instance in
       * src/yjs-runtime.ts, since a second copy would share no class identities
       * (WordPress/gutenberg#81999 removes the old `wp.sync.Y` global).
       */
      yjs: path.resolve(__dirname, "src/yjs-runtime.ts"),
    },
  },
};

const output = (keepOthers) => ({
  ...defaultConfig.output,
  path: path.resolve(__dirname, "build"),
  clean: {
    keep: (asset) => /^(fonts|images)\//.test(asset) || keepOthers.test(asset),
  },
});

const withoutExtraction = defaultConfig.plugins.filter(
  (plugin) => plugin.constructor.name !== "DependencyExtractionWebpackPlugin",
);

module.exports = [
  {
    ...base,
    entry: {
      client: path.resolve(__dirname, "src/client.ts"),
      "yjs-provider": path.resolve(__dirname, "src/yjs-provider-boot.ts"),
    },
    output: output(/^settings/),
  },
  {
    ...base,
    entry: {
      settings: path.resolve(__dirname, "src/settings/index.tsx"),
    },
    output: output(/^(client|yjs-provider)/),
    module: {
      ...base.module,
      rules: [
        ...base.module.rules,
        /*
         * @wordpress/theme declares no side effects, which would drop its token sheet; the settings
         * stylesheet reads those tokens.
         */
        { test: /@wordpress[\\/]theme[\\/].*\.css$/, sideEffects: true },
      ],
    },
    plugins: [
      ...withoutExtraction,
      new DependencyExtractionWebpackPlugin({
        requestToExternal(request) {
          /*
           * A sub-path of a bundled package (the theme's token sheet) is bundled with it, never
           * mapped to a `wp.*` global.
           */
          const pkg = request.split("/").slice(0, 2).join("/");
          return SETTINGS_BUNDLED.has(pkg) ? false : undefined;
        },
      }),
    ],
  },
];
