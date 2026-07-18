/**
 * 画廊页面逻辑
 * 左侧缩略图 + 右侧详情大图
 */

/**
 * 转义字符串以安全插入 HTML 属性，防止 URL 注入 HTML
 */
function escapeAttr(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

class GalleryApp {
  constructor() {
    this.items = [];
    this.currentFilter = 'all';
    this.selectedId = null;
    this.categories = [
      { value: 'real', label: '真人' },
      { value: 'anime', label: '动漫' }
    ];
    this.usePresets = true;
    this.downloadedIds = new Set();

    this.cacheElements();
    this.bindEvents();
    this.loadSettings();
    this.loadItems();
    this.listenForNewItems();
  }

  cacheElements() {
    this.thumbList = document.getElementById('g-thumb-list');
    this.countEl = document.getElementById('g-count');
    this.emptyEl = document.getElementById('g-empty');
    this.detailEl = document.getElementById('g-detail');
    this.detailEmptyEl = document.getElementById('g-detail-empty');
    this.detailTypeEl = document.getElementById('g-detail-type');
    this.detailMediaEl = document.getElementById('g-detail-media');
    this.dlButtonsEl = document.getElementById('g-dl-buttons');
    this.downloadedBadge = document.getElementById('g-downloaded-badge');
    this.openTabBtn = document.getElementById('g-open-tab');
    this.deleteBtn = document.getElementById('g-delete');
    this.filterBtns = document.querySelectorAll('.g-filter-btn');
  }

  bindEvents() {
    this.filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        this.renderThumbs();
        this.updateCount();
      });
    });

    this.openTabBtn.addEventListener('click', () => {
      const item = this.items.find(i => i.id === this.selectedId);
      if (item && item.url) {
        window.open(item.url, '_blank');
      }
    });

    this.deleteBtn.addEventListener('click', () => {
      if (this.selectedId) {
        this.items = this.items.filter(i => i.id !== this.selectedId);
        this.selectedId = null;
        this.renderThumbs();
        this.showDetail(null);
        this.updateCount();
        this.showToast('已删除', 'danger');
      }
    });
  }

  async loadSettings() {
    try {
      const settings = await chrome.runtime.sendMessage({ action: 'get_settings' });
      if (settings) {
        this.usePresets = settings.usePresets !== false;
        this.categories = settings.customCategories || this.categories;
      }
    } catch (e) {}
  }

  async loadItems() {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'get_captured_media' });
      if (result && result.items) {
        this.items = result.items;
      }
    } catch (e) {}

    if (this.items.length > 0) {
      await this.checkDownloaded();
    }
    this.renderThumbs();
    this.updateCount();

    // 自动选中第一个
    if (this.items.length > 0) {
      this.showDetail(this.items[0]);
    }
  }

  listenForNewItems() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'media_intercepted_forward' && message.items) {
        const existingIds = new Set(this.items.map(i => i.id));
        let added = false;
        message.items.forEach(item => {
          if (!existingIds.has(item.id)) {
            this.items.push(item);
            added = true;
          }
        });
        if (added) {
          this.renderThumbs();
          this.updateCount();
        }
      }
    });
  }

  async checkDownloaded() {
    const ids = this.items.map(i => i.id);
    if (ids.length === 0) return;
    try {
      const result = await chrome.runtime.sendMessage({
        action: 'check_history',
        ids: ids,
        items: this.items
      });
      if (result) {
        this.downloadedIds.clear();
        Object.keys(result).forEach(id => {
          if (result[id]) this.downloadedIds.add(id);
        });
      }
    } catch (e) {}
  }

  getFilteredItems() {
    if (this.currentFilter === 'all') return this.items;
    if (this.currentFilter === 'photo') return this.items.filter(i => i.type === 'photo');
    if (this.currentFilter === 'video') return this.items.filter(i => i.type === 'video' || i.type === 'animated_gif');
    return this.items;
  }

  renderThumbs() {
    const items = this.getFilteredItems();
    this.thumbList.innerHTML = '';

    if (items.length === 0) {
      this.emptyEl.style.display = 'block';
      return;
    }
    this.emptyEl.style.display = 'none';

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'g-thumb';
      if (item.id === this.selectedId) div.classList.add('active');
      if (this.downloadedIds.has(item.id)) div.classList.add('downloaded');

      const typeLabel = item.type === 'photo' ? '图' : (item.type === 'animated_gif' ? 'GIF' : '视频');
      div.innerHTML = `
        <img src="${escapeAttr(item.thumb)}" loading="lazy">
        <span class="g-thumb-type">${typeLabel}</span>
      `;
      div.addEventListener('click', () => this.showDetail(item));
      this.thumbList.appendChild(div);
    });
  }

  showDetail(item) {
    if (!item) {
      this.detailEl.style.display = 'none';
      this.detailEmptyEl.style.display = 'flex';
      this.selectedId = null;
      this.renderThumbs();
      return;
    }

    this.selectedId = item.id;
    this.detailEmptyEl.style.display = 'none';
    this.detailEl.style.display = 'flex';

    const typeLabel = item.type === 'photo' ? '图片' : (item.type === 'animated_gif' ? 'GIF' : '视频');
    this.detailTypeEl.textContent = typeLabel;

    // 大图/视频
    if (item.type === 'photo') {
      this.detailMediaEl.innerHTML = `<img src="${escapeAttr(item.url)}" alt="">`;
    } else {
      this.detailMediaEl.innerHTML = `<video src="${escapeAttr(item.url)}" controls autoplay loop></video>`;
    }

    // 下载按钮
    const isDownloaded = this.downloadedIds.has(item.id);
    if (isDownloaded) {
      this.dlButtonsEl.style.display = 'none';
      this.downloadedBadge.style.display = 'flex';
    } else {
      this.dlButtonsEl.style.display = 'flex';
      this.downloadedBadge.style.display = 'none';
      this.renderDownloadButtons(item);
    }

    this.renderThumbs();
  }

  renderDownloadButtons(item) {
    this.dlButtonsEl.innerHTML = '';
    if (this.usePresets && this.categories.length > 0) {
      this.categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'g-dl-btn';
        btn.textContent = cat.label;
        btn.addEventListener('click', () => this.downloadItem(item, cat.value));
        this.dlButtonsEl.appendChild(btn);
      });
    } else {
      const btn = document.createElement('button');
      btn.className = 'g-dl-btn single';
      btn.textContent = '下载';
      btn.addEventListener('click', () => this.downloadItem(item, ''));
      this.dlButtonsEl.appendChild(btn);
    }
  }

  async downloadItem(item, category) {
    try {
      const result = await chrome.runtime.sendMessage({
        action: 'download_media',
        items: [item],
        category: category
      });

      if (result) {
        if (result.downloaded && result.downloaded.length > 0) {
          this.downloadedIds.add(item.id);
          this.showDetail(item);
          this.showToast('下载成功', 'success');
        }
        if (result.duplicates && result.duplicates.length > 0) {
          this.downloadedIds.add(item.id);
          this.showDetail(item);
          this.showToast('已下载过', 'danger');
        }
      }
    } catch (e) {
      this.showToast('下载失败', 'danger');
    }
  }

  updateCount() {
    const count = this.getFilteredItems().length;
    this.countEl.textContent = count;
  }

  showToast(msg, type = '') {
    const toast = document.createElement('div');
    toast.className = `g-toast ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new GalleryApp();
});
