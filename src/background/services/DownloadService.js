import browser from '@/modules/Extension/browser';
import AbstractService from './AbstractService';

class DownloadService extends AbstractService {
  static instance;

  cachedUrlFilenameMap = new Map();

  static onDeterminingFilenameListenered = false;

  constructor() {
    super();
    this.listenOnDeterminingFilename();
  }

  listenOnDeterminingFilename() {
    if (DownloadService.onDeterminingFilenameListenered) return;
    DownloadService.onDeterminingFilenameListenered = true;

    browser.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
      if (this.cachedUrlFilenameMap.has(downloadItem.url)) {
        suggest({
          filename: this.cachedUrlFilenameMap.get(downloadItem.url),
          conflictAction: 'uniquify'
        });
        this.cachedUrlFilenameMap.delete(downloadItem.url);
      } else {
        suggest({
          filename: downloadItem.filename,
          conflictAction: 'uniquify'
        });
      }
    });
  }

  static getService() {
    if (!DownloadService.instance) {
      DownloadService.instance = new DownloadService();
    }
    return DownloadService.instance;
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
      const exists = await historyService.hasItem(item.id, item.thumb, item.phash);
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

        this.cachedUrlFilenameMap.set(item.url, filename);

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
