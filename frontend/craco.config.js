const path = require("path");
require("dotenv").config();

// Environment variable overrides
const config = {
  disableHotReload: process.env.DISABLE_HOT_RELOAD === "true",
  enableVisualEdits: process.env.REACT_APP_ENABLE_VISUAL_EDITS === "true",
  enableHealthCheck: process.env.ENABLE_HEALTH_CHECK === "true",
};

// Conditionally load visual editing modules only if enabled
let babelMetadataPlugin;
let setupDevServer;

if (config.enableVisualEdits) {
  babelMetadataPlugin = require("./plugins/visual-edits/babel-metadata-plugin");
  setupDevServer = require("./plugins/visual-edits/dev-server-setup");
}

// Conditionally load health check modules only if enabled
let WebpackHealthPlugin;
let setupHealthEndpoints;
let healthPluginInstance;

if (config.enableHealthCheck) {
  WebpackHealthPlugin = require("./plugins/health-check/webpack-health-plugin");
  setupHealthEndpoints = require("./plugins/health-check/health-endpoints");
  healthPluginInstance = new WebpackHealthPlugin();
}

const webpackConfig = {
  // --- ESLint: safe for ESLint v8 ---
  eslint: {
    enable: true, // just enable or disable ESLint; remove extensions & resolvePluginsRelativeTo
  },

  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    configure: (webpackConfig) => {
      // Disable hot reload completely if environment variable is set
      if (config.disableHotReload) {
        webpackConfig.plugins = webpackConfig.plugins.filter(
          (plugin) => plugin.constructor.name !== "HotModuleReplacementPlugin"
        );

        webpackConfig.watch = false;
        webpackConfig.watchOptions = { ignored: /.*/ }; // ignore all files
      } else {
        webpackConfig.watchOptions = {
          ...webpackConfig.watchOptions,
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/build/**',
            '**/dist/**',
            '**/coverage/**',
            '**/public/**',
          ],
        };
      }

      // Add health check plugin if enabled
      if (config.enableHealthCheck && healthPluginInstance) {
        webpackConfig.plugins.push(healthPluginInstance);
      }

      return webpackConfig;
    },
  },

  // Only add babel plugin if visual editing is enabled
  ...(config.enableVisualEdits && {
    babel: {
      plugins: [babelMetadataPlugin],
    },
  }),

  // Dev server setup
  ...(config.enableVisualEdits || config.enableHealthCheck
    ? {
        devServer: (devServerConfig) => {
          if (config.enableVisualEdits && setupDevServer) {
            devServerConfig = setupDevServer(devServerConfig);
          }

          if (config.enableHealthCheck && setupHealthEndpoints && healthPluginInstance) {
            const originalSetupMiddlewares = devServerConfig.setupMiddlewares;

            devServerConfig.setupMiddlewares = (middlewares, devServer) => {
              if (originalSetupMiddlewares) {
                middlewares = originalSetupMiddlewares(middlewares, devServer);
              }

              setupHealthEndpoints(devServer, healthPluginInstance);

              return middlewares;
            };
          }

          return devServerConfig;
        },
      }
    : {}),
};

module.exports = webpackConfig;
