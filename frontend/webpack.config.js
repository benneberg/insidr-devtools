const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  mode: 'production',
  entry: './src/standalone.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'devtools.bundle.js',
    library: {
      name: 'CustomDevTools',
      type: 'umd',
      export: 'default',
    },
    globalObject: 'this',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              '@babel/preset-env',
              ['@babel/preset-react', { runtime: 'automatic' }],
            ],
          },
        },
      },
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          'postcss-loader',
        ],
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif|ico)$/i,
        type: 'asset/resource',
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: 'devtools.css',
    }),
  ],
  externals: {
    // Don't bundle React if it's already available
    // Uncomment these if you want to use external React
    // react: {
    //   commonjs: 'react',
    //   commonjs2: 'react',
    //   amd: 'react',
    //   root: 'React',
    // },
    // 'react-dom': {
    //   commonjs: 'react-dom',
    //   commonjs2: 'react-dom',
    //   amd: 'react-dom',
    //   root: 'ReactDOM',
    // },
  },
  performance: {
    maxEntrypointSize: 512000,
    maxAssetSize: 512000,
  },
  optimization: {
    minimize: true,
  },
};
