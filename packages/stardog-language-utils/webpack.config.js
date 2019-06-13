const path = require('path');
const { isCI } = require('ci-info');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist');

const cliConfig = {
  mode: 'production',
  target: 'node',
  entry: path.join(SRC_DIR, 'cli.ts'),
  output: {
    path: DIST_DIR,
    filename: 'cli.js',
    library: 'stardog-language-utils',
    libraryTarget: 'umd',
    umdNamedDefine: true,
    globalObject: "typeof self !== 'undefined' ? self : this", // https://github.com/webpack/webpack/issues/6525
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
      },
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
      workers: isCI
        ? ForkTsCheckerWebpackPlugin.ONE_CPU
        : ForkTsCheckerWebpackPlugin.TWO_CPUS_FREE,
    }),
    new CopyWebpackPlugin([
      {
        from: `${SRC_DIR}/index.d.ts`,
        to: path.join(DIST_DIR, 'types', 'index.d.ts'),
      },
    ]),
  ],
  devtool: 'source-map',
};

const workerConfig = {
  mode: 'production',
  target: 'webworker',
  entry: path.join(SRC_DIR, 'worker.ts'),
  output: {
    path: DIST_DIR,
    filename: 'worker.js',
    library: 'stardog-language-utils',
    libraryTarget: 'umd',
    umdNamedDefine: true,
    globalObject: "typeof self !== 'undefined' ? self : this", // https://github.com/webpack/webpack/issues/6525
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
      },
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
      workers: isCI
        ? ForkTsCheckerWebpackPlugin.ONE_CPU
        : ForkTsCheckerWebpackPlugin.TWO_CPUS_FREE,
    }),
  ],
  devtool: 'source-map',
  node: {
    child_process: 'empty',
    net: 'empty',
    fs: 'empty',
    net: 'empty',
  },
};

module.exports = [cliConfig, workerConfig];
