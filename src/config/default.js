export default {
  version: '2.0.0',
  downloadFolder: 'X_Downloads',
  categoryFolders: {
    real: '真人',
    anime: '动漫'
  },
  usePresets: true,
  customCategories: [
    { value: 'real', label: '真人' },
    { value: 'anime', label: '动漫' }
  ],
  autoOpenSidePanel: true,
  multipleDownloadsGapTime: 150,
  disableDownloadsShelf: false,
  enableSaveDownloadHistory: true,
  maxHistoryItems: 0, // 0 = 永久保留，不截断（依赖 unlimitedStorage 权限）
  dedupByThumb: false,
  dedupByPhash: false,
  clickToOpen: false,
  fullViewMode: false,
  hideStaged: false,
  hoverAutoplay: true,
  gridCardSize: 0
};
