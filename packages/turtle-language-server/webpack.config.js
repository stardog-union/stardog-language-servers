const path = require('path');
const { isCI } = require('ci-info');
const { BannerPlugin } = require('webpack');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

const SRC_DIR = path.join(__dirname, 'src');

// Don't minify the parser names; this breaks chevrotain. See here: https://sap.github.io/chevrotain/docs/FAQ.html#MINIFIED
const reserved = [
  'BaseSparqlParser',
  'W3SpecSparqlParser',
  'StardogSparqlParser',
  'BaseGraphQlParser',
  'StandardGraphQlParser',
  'StardogGraphQlParser',
  'SrsParser',
  'SmsParser',
  'TurtleParser',
  'TrigParser',
  'ShaclParser',
  'Parser',
];

const cliConfig = {
  mode: 'production',
  target: 'node',
  entry: path.join(SRC_DIR, 'cli.ts'),
  output: {
    path: path.join(__dirname, 'dist'),
    filename: 'cli.js',
    library: 'turtle-language-server',
    libraryTarget: 'umd',
    umdNamedDefine: true,
    globalObject: 'typeof self !== \'undefined\' ? self : this', // https://github.com/webpack/webpack/issues/6525
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        enforce: 'pre',
        loader: 'tslint-loader',
        exclude: [/node_modules/],
      },
      {
        test: /\.ts$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              // Use ts-loader only for transpilation; type checking is handled
              // by ForkTsCheckerWebpackPlugin
              transpileOnly: true,
            },
          },
        ],
        exclude: [/node_modules/],
      }
    ],
  },
  resolve: {
    modules: [SRC_DIR, 'node_modules'],
    extensions: ['.ts', '.js'],
  },
  plugins: [
    new BannerPlugin({
      banner: '#!/usr/bin/env node',
    }),
    new ForkTsCheckerWebpackPlugin({
      tsconfig: path.resolve(__dirname, 'tsconfig.json'),
      watch: SRC_DIR,
      // CI memory limits make building with more than one CPU for type-checking too fragile, unfortunately
      workers: isCI ? ForkTsCheckerWebpackPlugin.ONE_CPU : ForkTsCheckerWebpackPlugin.TWO_CPUS_FREE,
      memoryLimit: 4096,
    }),
  ],
  devtool: 'source-map',
  optimization: {
    minimizer: [
      new TerserPlugin({
        sourceMap: true,
        terserOptions: {
          // Chevrotain does not cooperate with webpack mangling (see here: https://sap.github.io/chevrotain/docs/FAQ.html#MINIFIED).
          mangle: {
            reserved,
          },
        },
      }),
    ],
  },
};

const workerConfig = {
  mode: 'production',
  target: 'webworker',
  entry: path.join(SRC_DIR, 'worker.ts'),
  output: {
    path: path.join(__dirname, 'dist'),
    filename: 'worker.js',
    library: 'turtle-language-server',
    libraryTarget: 'umd',
    umdNamedDefine: true,
    globalObject: 'typeof self !== \'undefined\' ? self : this', // https://github.com/webpack/webpack/issues/6525
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        enforce: 'pre',
        loader: 'tslint-loader',
        exclude: [/node_modules/],
      },
      {
        test: /\.ts$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              // Use ts-loader only for transpilation; type checking is handled
              // by ForkTsCheckerWebpackPlugin
              transpileOnly: true,
            },
          },
        ],
        exclude: [/node_modules/],
      }
    ],
  },
  resolve: {
    modules: [SRC_DIR, 'node_modules'],
    extensions: ['.ts', '.js'],
  },
  plugins: [
    new ForkTsCheckerWebpackPlugin({
      tsconfig: path.resolve(__dirname, 'tsconfig.json'),
      watch: SRC_DIR,
      // CI memory limits make building with more than one CPU for type-checking too fragile, unfortunately
      workers: isCI ? ForkTsCheckerWebpackPlugin.ONE_CPU : ForkTsCheckerWebpackPlugin.TWO_CPUS_FREE,
      memoryLimit: 4096,
    }),
  ],
  devtool: 'source-map',
  node: {
    child_process: 'empty',
    net: 'empty',
    fs: 'empty',
    net: 'empty',
  },
  optimization: {
    minimizer: [
      new TerserPlugin({
        sourceMap: true,
        terserOptions: {
          // Chevrotain does not cooperate with webpack mangling (see here: https://sap.github.io/chevrotain/docs/FAQ.html#MINIFIED).
          mangle: {
            reserved,
          },
        },
      }),
    ],
  },
};

module.exports = [cliConfig, workerConfig];
