const path = require('path');
const os = require('os');
const { isCI } = require('ci-info');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

const SRC_DIR = path.join(__dirname, 'src');
const MAX_CI_CPUS = Math.min(8, os.cpus().length - 2); // more than 8 CPUs on CI tends to make the build use too much memory and OOM

const cliConfig = {
  mode: 'production',
  target: 'node',
  entry: path.join(SRC_DIR, 'cli.ts'),
  output: {
    path: path.join(__dirname, 'dist'),
    filename: 'cli.js',
    library: 'sparql-language-server',
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
      workers: isCI ? MAX_CI_CPUS : ForkTsCheckerWebpackPlugin.TWO_CPUS_FREE,
    }),
  ],
  devtool: 'source-map',
};

const workerConfig = {
  mode: 'production',
  target: 'webworker',
  entry: path.join(SRC_DIR, 'worker.ts'),
  output: {
    path: path.join(__dirname, 'dist'),
    filename: 'worker.js',
    library: 'sparql-language-server',
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
      workers: isCI ? MAX_CI_CPUS : ForkTsCheckerWebpackPlugin.TWO_CPUS_FREE,
    }),
  ],
  devtool: 'source-map',
  node: {
    child_process: 'empty',
    net: 'empty',
    fs: 'empty',
    net: 'empty',
  }
};

module.exports = [cliConfig, workerConfig];
