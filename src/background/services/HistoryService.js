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

  async getStats() {
    const history = await this.getAll();
    const entries = Object.values(history);
    const total = entries.length;
    const photos = entries.filter(e => e.type === 'photo').length;
    const videos = entries.filter(e => e.type === 'video' || e.type === 'animated_gif').length;

    // 按日期统计（最近 20 周 = 140 天）
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const dayMs = 86400000;
    const todayDay = now.getDay(); // 0=Sun
    const totalDays = 140;
    const startDate = new Date(now.getTime() - (totalDays - 1) * dayMs - todayDay * dayMs);

    // 构建日期 -> 数量映射
    const dateMap = {};
    entries.forEach(e => {
      if (!e.downloadedAt) return;
      const d = new Date(e.downloadedAt);
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      dateMap[key] = (dateMap[key] || 0) + 1;
    });

    // 生成格子数据：按周列，每周7天
    const weeks = [];
    let currentWeek = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate.getTime() + i * dayMs);
      const key = d.toISOString().slice(0, 10);
      const count = dateMap[key] || 0;
      currentWeek.push({
        date: key,
        count,
        month: d.getMonth(),
        future: d > new Date()
      });
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    // 月份标签
    const monthLabels = [];
    let lastMonth = -1;
    weeks.forEach(week => {
      const m = week[0].month;
      if (m !== lastMonth) {
        monthLabels.push({ weekIdx: monthLabels.length, month: m });
        lastMonth = m;
      } else {
        monthLabels.push(null);
      }
    });

    // 最大值（用于颜色分级）
    const maxCount = Math.max(...Object.values(dateMap), 1);

    return { total, photos, videos, weeks, monthLabels, maxCount };
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
