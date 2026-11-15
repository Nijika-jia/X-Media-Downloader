class MediaStore {
  constructor() {
    this.mediaMap = new Map();
    this.selectedIds = new Set();
    this.lastSelectedId = null;
    this.listeners = [];
    this.stagedMap = new Map(); // id -> 暂存项（含 category）
  }

  addItems(items, tabId) {
    let newItems = false;
    items.forEach(item => {
      if (!this.mediaMap.has(item.id)) {
        item._tabId = tabId == null ? item._tabId || null : tabId;
        this.applyStagedToItem(item);
        this.mediaMap.set(item.id, item);
        newItems = true;
      }
    });
    if (newItems) {
      this.notifyListeners('items_added');
    }
    return newItems;
  }

  /**
   * 用后台的暂存清单覆盖本地映射，并同步到已加载的媒体项
   */
  applyStaged(items) {
    this.stagedMap.clear();
    (items || []).forEach(item => {
      this.stagedMap.set(String(item.id), item);
    });
    this.mediaMap.forEach(item => this.applyStagedToItem(item));
    this.notifyListeners('staged_changed');
  }

  setStaged(id, staged) {
    if (staged) {
      this.stagedMap.set(String(id), staged);
    } else {
      this.stagedMap.delete(String(id));
    }
    const item = this.mediaMap.get(id);
    if (item) this.applyStagedToItem(item);
    this.notifyListeners('staged_changed');
  }

  /**
   * 批量暂存：一次写入并只通知一次，避免逐项触发重渲染
   */
  setStagedMany(items, category) {
    const cat = category == null ? '' : category;
    (items || []).forEach(item => {
      this.stagedMap.set(String(item.id), {
        id: item.id,
        url: item.url,
        thumb: item.thumb || null,
        type: item.type,
        phash: item.phash || null,
        dhash: item.dhash || null,
        category: cat,
        stagedAt: Date.now()
      });
    });
    this.mediaMap.forEach(item => this.applyStagedToItem(item));
    this.notifyListeners('staged_changed');
  }

  applyStagedToItem(item) {
    const staged = this.stagedMap.get(String(item.id));
    item._stagedCategory = staged ? staged.category : null;
  }

  getItem(id) {
    return this.mediaMap.get(id);
  }

  getAllItems() {
    return Array.from(this.mediaMap.values());
  }

  /**
   * 按「类型」+「下载状态」两个正交维度筛选
   * @param {string} typeFilter - all | photo | video
   * @param {string} statusFilter - all | downloaded | not_downloaded | staged
   * @param {boolean} hideStaged - 隐藏已暂存项（第二轮浏览时聚焦未看过的）
   */
  getFilteredItems(typeFilter = 'all', statusFilter = 'all', hideStaged = false) {
    const items = this.getAllItems();
    return items.filter(item => {
      if (typeFilter === 'photo' && item.type !== 'photo') return false;
      if (typeFilter === 'video' && item.type !== 'video' && item.type !== 'animated_gif') return false;
      if (statusFilter === 'downloaded' && !item.downloaded) return false;
      if (statusFilter === 'not_downloaded' && item.downloaded) return false;
      if (statusFilter === 'staged' && item._stagedCategory == null) return false;
      if (hideStaged && item._stagedCategory != null) return false;
      return true;
    });
  }

  markDownloaded(ids) {
    ids.forEach(id => {
      const item = this.mediaMap.get(id);
      if (item) {
        item.downloaded = true;
        item.downloading = false;
        item.downloadState = null;
      }
    });
    this.notifyListeners('items_updated');
  }

  markDownloading(ids, state = 'downloading') {
    const nextState = ['queued', 'downloading', 'retrying'].includes(state)
      ? state
      : 'downloading';
    ids.forEach(id => {
      const item = this.mediaMap.get(id);
      if (item && !item.downloaded) {
        item.downloading = true;
        item.downloadState = nextState;
      }
    });
    this.notifyListeners('items_updated');
  }

  markNotDownloaded(ids) {
    ids.forEach(id => {
      const item = this.mediaMap.get(id);
      if (item) {
        item.downloaded = false;
        item.downloading = false;
        item.downloadState = null;
      }
    });
    this.notifyListeners('items_updated');
  }

  syncDownloaded(downloadedIds) {
    const downloadedSet = new Set((downloadedIds || []).map(id => String(id)));
    this.mediaMap.forEach((item, id) => {
      item.downloaded = downloadedSet.has(String(id));
      if (item.downloaded) {
        item.downloading = false;
        item.downloadState = null;
      }
    });
    this.notifyListeners('items_updated');
  }

  removeItems(ids) {
    ids.forEach(id => {
      this.mediaMap.delete(id);
      this.selectedIds.delete(id);
      this.stagedMap.delete(String(id));
    });
    this.notifyListeners('items_removed');
  }

  selectItem(id, selected) {
    if (selected) {
      this.selectedIds.add(id);
    } else {
      this.selectedIds.delete(id);
    }
    this.lastSelectedId = id;
    this.notifyListeners('selection_changed');
  }

  selectRange(fromId, toId, visibleIds) {
    const fromIdx = visibleIds.indexOf(fromId);
    const toIdx = visibleIds.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;

    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);
    const shouldSelect = !this.selectedIds.has(toId);

    for (let i = start; i <= end; i++) {
      if (shouldSelect) {
        this.selectedIds.add(visibleIds[i]);
      } else {
        this.selectedIds.delete(visibleIds[i]);
      }
    }
    this.lastSelectedId = toId;
    this.notifyListeners('selection_changed');
  }

  selectAll(visibleIds) {
    if (!visibleIds || visibleIds.length === 0) return;
    // 基于可见项判断是否已全选，避免过滤状态下与 mediaMap.size 比较导致 clear 分支不可达
    const allVisibleSelected = visibleIds.every(id => this.selectedIds.has(id));
    if (allVisibleSelected) {
      visibleIds.forEach(id => this.selectedIds.delete(id));
    } else {
      visibleIds.forEach(id => this.selectedIds.add(id));
    }
    this.notifyListeners('selection_changed');
  }

  clearSelection() {
    this.selectedIds.clear();
    this.notifyListeners('selection_changed');
  }

  getSelectedItems() {
    const items = [];
    this.selectedIds.forEach(id => {
      const item = this.mediaMap.get(id);
      if (item) items.push(item);
    });
    return items;
  }

  clear() {
    this.mediaMap.clear();
    this.selectedIds.clear();
    this.lastSelectedId = null;
    this.notifyListeners('cleared');
  }

  getCounts() {
    // 单次遍历统计，避免频繁点击时多次过滤大列表
    let total = 0;
    let photos = 0;
    let videos = 0;
    let downloaded = 0;
    let downloading = 0;
    this.mediaMap.forEach(item => {
      total++;
      if (item.type === 'photo') {
        photos++;
      } else if (item.type === 'video' || item.type === 'animated_gif') {
        videos++;
      }
      if (item.downloaded) downloaded++;
      if (item.downloading) downloading++;
    });
    return { total, photos, videos, downloaded, downloading, notDownloaded: total - downloaded };
  }

  addListener(callback) {
    this.listeners.push(callback);
  }

  notifyListeners(event) {
    this.listeners.forEach(cb => cb(event));
  }

  /**
   * 导出所有媒体数据为可序列化的对象
   * @returns {Object} 包含导出数据和元信息
   */
  /**
   * 导出媒体数据为可序列化的对象
   * @param {Array} sourceItems 要导出的项，不传则导出全部
   * @returns {Object} 包含导出数据和元信息
   */
  exportData(sourceItems) {
    const items = Array.isArray(sourceItems) ? sourceItems : this.getAllItems();
    const exportItems = items.map(item => ({
      id: item.id,
      url: item.url,
      thumb: item.thumb,
      type: item.type,
      tweetUrl: item.tweetUrl,
      author: item.author,
      downloaded: item.downloaded || false,
      phash: item.phash || null,
      dhash: item.dhash || null,
      timestamp: item.timestamp || Date.now()
    }));

    return {
      version: 1,
      exportTime: Date.now(),
      count: exportItems.length,
      items: exportItems
    };
  }

  /**
   * 从导出的数据导入媒体项
   * @param {Object} data - 导出的数据对象
   * @returns {Object} 导入结果统计
   */
  importData(data) {
    if (!data || !data.items || !Array.isArray(data.items)) {
      return { success: false, error: '无效的导入数据格式' };
    }

    let added = 0;
    let skipped = 0;

    data.items.forEach(item => {
      if (!item.id || !item.url) {
        skipped++;
        return;
      }

      if (!this.mediaMap.has(item.id)) {
        this.mediaMap.set(item.id, {
          id: item.id,
          url: item.url,
          thumb: item.thumb,
          type: item.type,
          tweetUrl: item.tweetUrl,
          author: item.author,
          downloaded: item.downloaded || false,
          phash: item.phash || null,
          dhash: item.dhash || null,
          timestamp: item.timestamp || Date.now()
        });
        added++;
      } else {
        skipped++;
      }
    });

    if (added > 0) {
      this.notifyListeners('items_added');
    }

    return {
      success: true,
      added,
      skipped,
      total: data.items.length
    };
  }
}

export default MediaStore;
