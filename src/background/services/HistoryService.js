import browser from '@/modules/Extension/browser';
import AbstractService from './AbstractService';

const STORAGE_KEY = 'x_download_history';

class HistoryService extends AbstractService {
  static instance;

  static getService() {
    if (!HistoryService.instance) {
      HistoryService.instance = new HistoryService();
    }
    return HistoryService.instance;
  }

  async getAll() {
    return new Promise(resolve => {
      browser.storage.local.get(STORAGE_KEY, result => {
        resolve(result[STORAGE_KEY] || {});
      });
    });
  }

  async getItems(ids) {
    const history = await this.getAll();
    const result = {};
    ids.forEach(id => {
      if (history[id]) {
        result[id] = history[id];
      }
    });
    return result;
  }

  async hasItem(id) {
    const history = await this.getAll();
    return !!history[id];
  }

  async checkDownloaded(ids) {
    const history = await this.getAll();
    const result = {};
    ids.forEach(id => {
      result[id] = !!history[id];
    });
    return result;
  }

  async addItems(items) {
    const history = await this.getAll();
    const now = Date.now();
    items.forEach(item => {
      history[item.id] = {
        id: item.id,
        type: item.type,
        url: item.url,
        thumb: item.thumb,
        downloadedAt: now
      };
    });
    await this.save(history);
    return history;
  }

  async removeItems(ids) {
    const history = await this.getAll();
    ids.forEach(id => {
      delete history[id];
    });
    await this.save(history);
  }

  async clear() {
    await this.save({});
  }

  async save(history) {
    const maxItems = this.application
      ? this.application.settings.maxHistoryItems || 10000
      : 10000;

    const entries = Object.entries(history);
    if (entries.length > maxItems) {
      entries.sort((a, b) => (b[1].downloadedAt || 0) - (a[1].downloadedAt || 0));
      const trimmed = {};
      entries.slice(0, maxItems).forEach(([key, val]) => {
        trimmed[key] = val;
      });
      history = trimmed;
    }

    return new Promise(resolve => {
      browser.storage.local.set({ [STORAGE_KEY]: history }, resolve);
    });
  }
}

export default HistoryService;
