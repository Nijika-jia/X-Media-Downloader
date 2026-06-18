import browser from '@/modules/Extension/browser';
import AbstractService from './AbstractService';

const STORAGE_KEY = 'x_download_history';
const THUMB_INDEX_KEY = 'x_download_thumb_index';
const PHASH_INDEX_KEY = 'x_download_phash_index';
const PHASH_THRESHOLD = 5; // 汉明距离阈值，<=5 视为同一张图

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

  async getThumbIndex() {
    return new Promise(resolve => {
      browser.storage.local.get(THUMB_INDEX_KEY, result => {
        resolve(result[THUMB_INDEX_KEY] || {});
      });
    });
  }

  async getPhashIndex() {
    return new Promise(resolve => {
      browser.storage.local.get(PHASH_INDEX_KEY, result => {
        resolve(result[PHASH_INDEX_KEY] || []);
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

  async hasItem(id, thumb = null, phash = null) {
    const history = await this.getAll();
    if (history[id]) return true;

    // 启用封面去重时，检查 thumb 索引
    if (thumb && this.application && this.application.settings.dedupByThumb) {
      const thumbIndex = await this.getThumbIndex();
      const thumbKey = this.normalizeThumb(thumb);
      if (thumbIndex[thumbKey]) return true;
    }

    // 启用 pHash 去重时，检查相似图
    if (phash && this.application && this.application.settings.dedupByPhash) {
      const phashIndex = await this.getPhashIndex();
      for (const entry of phashIndex) {
        if (this.hammingDistance(phash, entry.phash) <= PHASH_THRESHOLD) {
          return true;
        }
      }
    }
    return false;
  }

  normalizeThumb(thumb) {
    if (!thumb) return '';
    return thumb.split('?')[0].replace(/\/name=[a-z0-9]+$/, '');
  }

  /**
   * 计算两个十六进制 pHash 的汉明距离
   */
  hammingDistance(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) return 64;
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      const n1 = parseInt(hash1[i], 16);
      const n2 = parseInt(hash2[i], 16);
      let xor = n1 ^ n2;
      while (xor) {
        distance += xor & 1;
        xor >>= 1;
      }
    }
    return distance;
  }

  async checkDownloaded(ids, items = null) {
    const history = await this.getAll();
    const result = {};

    // 构建 id -> thumb/phash 映射
    let thumbMap = {};
    let phashMap = {};
    let thumbIndex = null;
    let phashIndex = null;

    if (items && this.application) {
      if (this.application.settings.dedupByThumb) {
        thumbIndex = await this.getThumbIndex();
      }
      if (this.application.settings.dedupByPhash) {
        phashIndex = await this.getPhashIndex();
      }
      items.forEach(item => {
        if (item.thumb) {
          thumbMap[item.id] = this.normalizeThumb(item.thumb);
        }
        if (item.phash) {
          phashMap[item.id] = item.phash;
        }
      });
    }

    ids.forEach(id => {
      if (history[id]) {
        result[id] = true;
      } else if (thumbIndex && thumbMap[id] && thumbIndex[thumbMap[id]]) {
        result[id] = true;
      } else if (phashIndex && phashMap[id]) {
        // 检查 pHash 相似度
        let found = false;
        for (const entry of phashIndex) {
          if (this.hammingDistance(phashMap[id], entry.phash) <= PHASH_THRESHOLD) {
            found = true;
            break;
          }
        }
        result[id] = found;
      } else {
        result[id] = false;
      }
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
        phash: item.phash || null,
        downloadedAt: now
      };
    });
    await this.save(history);

    // 同步更新封面索引
    if (this.application && this.application.settings.dedupByThumb) {
      await this.updateThumbIndex(items);
    }

    // 同步更新 pHash 索引
    if (this.application && this.application.settings.dedupByPhash) {
      await this.updatePhashIndex(items);
    }
    return history;
  }

  async updateThumbIndex(items) {
    const thumbIndex = await this.getThumbIndex();
    items.forEach(item => {
      if (item.thumb) {
        const key = this.normalizeThumb(item.thumb);
        if (!thumbIndex[key]) {
          thumbIndex[key] = [];
        }
        if (!thumbIndex[key].includes(item.id)) {
          thumbIndex[key].push(item.id);
        }
      }
    });
    return new Promise(resolve => {
      browser.storage.local.set({ [THUMB_INDEX_KEY]: thumbIndex }, resolve);
    });
  }

  async updatePhashIndex(items) {
    const phashIndex = await this.getPhashIndex();
    items.forEach(item => {
      if (item.phash) {
        // 避免重复添加
        const exists = phashIndex.some(e => e.id === item.id);
        if (!exists) {
          phashIndex.push({ id: item.id, phash: item.phash });
        }
      }
    });

    // 限制索引大小
    if (phashIndex.length > 5000) {
      phashIndex = phashIndex.slice(-5000);
    }

    return new Promise(resolve => {
      browser.storage.local.set({ [PHASH_INDEX_KEY]: phashIndex }, resolve);
    });
  }

  async removeItems(ids) {
    const history = await this.getAll();
    const thumbIndex = await this.getThumbIndex();
    const phashIndex = await this.getPhashIndex();

    ids.forEach(id => {
      const item = history[id];
      if (item && item.thumb) {
        const key = this.normalizeThumb(item.thumb);
        if (thumbIndex[key]) {
          thumbIndex[key] = thumbIndex[key].filter(x => x !== id);
          if (thumbIndex[key].length === 0) {
            delete thumbIndex[key];
          }
        }
      }
      // 从 pHash 索引移除
      const phashIdx = phashIndex.findIndex(e => e.id === id);
      if (phashIdx >= 0) {
        phashIndex.splice(phashIdx, 1);
      }
      delete history[id];
    });

    await this.save(history);
    await new Promise(resolve => {
      browser.storage.local.set({ [THUMB_INDEX_KEY]: thumbIndex }, resolve);
    });
    await new Promise(resolve => {
      browser.storage.local.set({ [PHASH_INDEX_KEY]: phashIndex }, resolve);
    });
  }

  async clear() {
    await this.save({});
    await new Promise(resolve => {
      browser.storage.local.set({ [THUMB_INDEX_KEY]: {} }, resolve);
    });
    await new Promise(resolve => {
      browser.storage.local.set({ [PHASH_INDEX_KEY]: [] }, resolve);
    });
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
