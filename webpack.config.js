const defaultConfig = require("@wordpress/scripts/config/webpack.config");
const DependencyExtractionWebpackPlugin = require("@wordpress/dependency-extraction-webpack-plugin");
const path = require("path");

/*
 * Two compilations over one `build/`: the settings entry bundles every `@wordpress` package but the
 * ones below, while the client entries keep core's `wp-private-apis` for the Yjs provider. Each cleans
 * `build/` but keeps the other's files.
 */
const SETTINGS_FROM_CORE = new Set([
  "@wordpress/element",
  "@wordpress/i18n",
  "@wordpress/hooks",
  "@wordpress/api-fetch",
  "@wordpress/data",
  "@wordpress/notices",
  "@wordpress/plugins",
  "@wordpress/dom-ready",
  "@wordpress/date",
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
         * These packages declare no side effects, which would drop the stylesheets the app imports:
         * the theme's tokens, the components' and DataViews' styles.
         */
        { test: /@wordpress[\\/](theme|components|dataviews)[\\/].*\.css$/, sideEffects: true },
      ],
    },
    plugins: [
      ...withoutExtraction,
      new DependencyExtractionWebpackPlugin({
        requestToExternal(request) {
          /*
           * A `@wordpress` package outside the core set is bundled, sub-paths (a stylesheet) with
           * it, never mapped to a `wp.*` global.
           */
          const pkg = request.split("/").slice(0, 2).join("/");
          if (pkg.startsWith("@wordpress/") && !SETTINGS_FROM_CORE.has(pkg)) return false;
          return undefined;
        },
      }),
    ],
  },
];
