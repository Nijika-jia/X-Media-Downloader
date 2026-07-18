const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  entry: {
    background: './src/background/Bootstrap.js',
    content: './src/content/index.js',
    inject: './src/inject/index.js',
    sidepanel: './src/sidepanel/index.js',
    popup: './src/popup/index.js',
    gallery: './src/gallery/index.js',
    downloadcenter: './src/downloadcenter/index.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true
  },
  resolve: {
    extensions: ['.js'],
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader']
      }
    ]
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: '[name].css'
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'icons', to: 'icons' },
        { from: 'src/sidepanel/sidepanel.html', to: 'sidepanel.html' },
        { from: 'src/sidepanel/sidepanel.css', to: 'sidepanel.css' },
        { from: 'src/popup/popup.html', to: 'popup.html' },
        { from: 'src/gallery/gallery.html', to: 'gallery.html' },
        { from: 'src/gallery/gallery.css', to: 'gallery.css' },
        { from: 'src/downloadcenter/downloadcenter.html', to: 'downloadcenter.html' },
        { from: 'src/downloadcenter/downloadcenter.css', to: 'downloadcenter.css' },
        { from: 'src/content/content.css', to: 'content.css' },
        { from: 'manifest.json', to: 'manifest.json' }
      ]
    })
  ],
  optimization: {
    minimize: false
  },
  devtool: 'cheap-module-source-map'
};
