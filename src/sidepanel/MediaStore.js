class MediaStore {
  constructor() {
    this.mediaMap = new Map();
    this.selectedIds = new Set();
    this.lastSelectedId = null;
    this.listeners = [];
  }

  addItems(items, tabId) {
    let newItems = false;
    items.forEach(item => {
      if (!this.mediaMap.has(item.id)) {
        item._tabId = tabId;
        this.mediaMap.set(item.id, item);
        newItems = true;
      }
    });
    if (newItems) {
      this.notifyListeners('items_added');
    }
    return newItems;
  }

  getItem(id) {
    return this.mediaMap.get(id);
  }

  getAllItems() {
    return Array.from(this.mediaMap.values());
  }

  getFilteredItems(filter) {
    const items = this.getAllItems();
    return items.filter(item => {
      if (filter === 'all') return true;
      if (filter === 'photo') return item.type === 'photo';
      if (filter === 'video') return item.type === 'video' || item.type === 'animated_gif';
      if (filter === 'downloaded') return item.downloaded;
      if (filter === 'not_downloaded') return !item.downloaded;
      return true;
    });
  }

  markDownloaded(ids) {
    ids.forEach(id => {
      const item = this.mediaMap.get(id);
      if (item) {
        item.downloaded = true;
      }
    });
    this.notifyListeners('items_updated');
  }

  removeItems(ids) {
    ids.forEach(id => {
      this.mediaMap.delete(id);
      this.selectedIds.delete(id);
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
    const allSelected = this.mediaMap.size > 0 && this.selectedIds.size === this.mediaMap.size;
    if (allSelected) {
      this.selectedIds.clear();
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
    const items = this.getAllItems();
    const total = items.length;
    const photos = items.filter(i => i.type === 'photo').length;
    const videos = items.filter(i => i.type === 'video' || i.type === 'animated_gif').length;
    const downloaded = items.filter(i => i.downloaded).length;
    const notDownloaded = total - downloaded;
    return { total, photos, videos, downloaded, notDownloaded };
  }

  addListener(callback) {
    this.listeners.push(callback);
  }

  notifyListeners(event) {
    this.listeners.forEach(cb => cb(event));
  }
}

export default MediaStore;
