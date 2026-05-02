import browser from '@/modules/Extension/browser';
import AbstractService from './AbstractService';

class DownloadService extends AbstractService {
  static instance;

  cachedDownloadIdFilenameMap = new Map();

  static onDeterminingFilenameListenered = false;

  constructor() {
    super();
    this.listenOnDeterminingFilename();
  }

  listenOnDeterminingFilename() {
    if (DownloadService.onDeterminingFilenameListenered === true) return;
    DownloadService.onDeterminingFilenameListenered = true;

    browser.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
      const filenameSuggestion = {
        conflictAction: 'uniquify'
      };

      if (this.cachedDownloadIdFilenameMap.has(downloadItem.url)) {
        filenameSuggestion.filename = this.cachedDownloadIdFilenameMap.get(downloadItem.url);
        this.cachedDownloadIdFilenameMap.delete(downloadItem.url);
      } else {
        filenameSuggestion.filename = downloadItem.filename;
      }

      suggest(filenameSuggestion);
    });
  }

  static getService() {
    if (!DownloadService.instance) {
      DownloadService.instance = new DownloadService();
    }
    return DownloadService.instance;
  }

  cacheDownloadIdFilename(url, filename) {
    this.cachedDownloadIdFilenameMap.set(url, filename);
  }

  getDownloadFolder(category) {
    const categoryFolders = this.application.settings.categoryFolders || {};
    const subFolder = categoryFolders[category];
    const baseFolder = this.application.settings.downloadFolder || 'X_Downloads';
    return subFolder ? `${baseFolder}/${subFolder}` : baseFolder;
  }

  async downloadMedia({ items, category }) {
    const historyService = this.application.getService('history');
    const duplicates = [];
    const newItems = [];

    for (const item of items) {
      const exists = await historyService.hasItem(item.id);
      if (exists) {
        duplicates.push(item);
      } else {
        newItems.push(item);
      }
    }

    if (newItems.length > 0) {
      const folder = this.getDownloadFolder(category || '');
      newItems.forEach(item => {
        let ext = 'jpg';
        if (item.type === 'video' || item.type === 'animated_gif') {
          ext = 'mp4';
        }
        const filename = `${folder}/x_${item.id}.${ext}`;

        this.cacheDownloadIdFilename(item.url, filename);

        browser.downloads.download({
          url: item.url,
          filename: filename,
          conflictAction: 'uniquify'
        });
      });

      await historyService.addItems(newItems);
    }

    return {
      downloaded: newItems.map(i => i.id),
      duplicates: duplicates.map(i => i.id)
    };
  }
}

export default DownloadService;
