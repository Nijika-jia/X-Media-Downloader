import MediaStore from './MediaStore';
import MediaGridRenderer from './MediaGridRenderer';

class SidePanelApp {
  constructor() {
    this.mediaStore = new MediaStore();
    this.renderer = new MediaGridRenderer(this.mediaStore);
    this.port = null;
    this.portReconnectTimer = null;

    this.cacheElements();
    this.bindEvents();
    this.listenForMessages();
    this.connectPort();
  }

  cacheElements() {
    this.selectAllBtn = document.getElementById('x-select-all-btn');
    this.downloadSelectedBtn = document.getElementById('x-download-selected-btn');
    this.downloadCategorySelect = document.getElementById('x-download-category');
    this.clearBtn = document.getElementById('x-clear-btn');
    this.countEl = document.getElementById('x-count');
    this.emptyState = document.getElementById('x-empty-state');
    this.filterBtns = document.querySelectorAll('.x-filter-btn');
    this.fullViewToggle = document.getElementById('x-full-view-toggle');
  }

  bindEvents() {
    this.renderer.onDownload = (items, category) => this.downloadItems(items, category);
    this.renderer.onShowLightbox = (item) => this.showLightbox(item);

    this.mediaStore.addListener((event) => {
      this.updateCount();
      this.updateSelectionUI();
    });

    this.filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderer.setFilter(btn.dataset.filter);
        this.updateCount();
      });
    });

    this.fullViewToggle.addEventListener('change', (e) => {
      document.body.classList.toggle('full-view-mode', e.target.checked);
    });

    this.selectAllBtn.addEventListener('click', () => {
      const visibleIds = Array.from(document.querySelectorAll('.x-media-item'))
        .map(el => el.dataset.id);
      this.mediaStore.selectAll(visibleIds);
      this.renderer.updateAllItemSelections();
    });

    this.downloadSelectedBtn.addEventListener('click', () => {
      const items = this.mediaStore.getSelectedItems();
      if (items.length === 0) return;

      this.downloadItems(items, this.downloadCategorySelect.value);
    });

    this.clearBtn.addEventListener('click', () => {
      this.mediaStore.clear();
      this.renderer.grid.innerHTML = '';
      this.updateCount();
      this.updateSelectionUI();
      this.emptyState.style.display = 'block';
    });
  }

  listenForMessages() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'media_intercepted_forward') {
        this.handleMediaItems(message.items, message.tabId);
      }
    });
  }

  connectPort() {
    try {
      this.port = chrome.runtime.connect({ name: 'media' });
      this.port.onMessage.addListener((message) => {
        if (message.event === 'media_intercepted') {
          this.handleMediaItems(message.items, message.tabId);
        }
      });
      this.port.onDisconnect.addListener(() => {
        this.port = null;
        this.schedulePortReconnect();
      });
    } catch (e) {
      this.port = null;
      this.schedulePortReconnect();
    }
  }

  schedulePortReconnect() {
    if (this.portReconnectTimer) return;
    this.portReconnectTimer = setTimeout(() => {
      this.portReconnectTimer = null;
      if (!this.port) {
        this.connectPort();
      }
    }, 3000);
  }

  async handleMediaItems(items, tabId) {
    const newItems = this.mediaStore.addItems(items, tabId);
    if (newItems) {
      await this.checkHistoryForNewItems();
      this.renderer.render();
      this.emptyState.style.display = 'none';
    }
  }

  async checkHistoryForNewItems() {
    const allIds = this.mediaStore.getAllItems().map(i => i.id);
    if (allIds.length === 0) return;

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'check_history',
        ids: allIds
      });

      if (result) {
        const downloadedIds = [];
        for (const id in result) {
          if (result[id]) {
            downloadedIds.push(id);
          }
        }
        if (downloadedIds.length > 0) {
          this.mediaStore.markDownloaded(downloadedIds);
        }
      }
    } catch (e) {}
  }

  async downloadItems(items, category = '') {
    try {
      const result = await chrome.runtime.sendMessage({
        action: 'download_media',
        items: items,
        category: category
      });

      if (result) {
        if (result.downloaded && result.downloaded.length > 0) {
          this.mediaStore.markDownloaded(result.downloaded);
          result.downloaded.forEach(id => {
            const div = this.renderer.grid.querySelector(`[data-id="${id}"]`);
            if (div) {
              const dlBtn = div.querySelector('.x-item-download-btn');
              if (dlBtn) this.renderer.markDownloadButtonDownloaded(dlBtn);
              this.renderer.updateItemSelection(div, id, false);
            }
          });
          this.mediaStore.clearSelection();
          this.renderer.updateAllItemSelections();
        }

        if (result.duplicates && result.duplicates.length > 0) {
          this.showDuplicateToast(result.duplicates.length);
          result.duplicates.forEach(id => {
            this.mediaStore.markDownloaded(id);
            const div = this.renderer.grid.querySelector(`[data-id="${id}"]`);
            if (div) {
              const dlBtn = div.querySelector('.x-item-download-btn');
              if (dlBtn) this.renderer.markDownloadButtonDownloaded(dlBtn);
              this.renderer.updateItemSelection(div, id, false);
            }
          });
          this.mediaStore.clearSelection();
          this.renderer.updateAllItemSelections();
        }
      }
    } catch (e) {}
  }

  showDuplicateToast(count) {
    const existing = document.querySelector('.x-duplicate-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'x-duplicate-toast';
    toast.innerHTML = `<span class="x-toast-icon">⚠️</span> ${count} 个文件已下载过，已跳过重复下载`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  showLightbox(item) {
    if (item._tabId) {
      chrome.tabs.sendMessage(item._tabId, {
        action: 'show_lightbox',
        item: item
      }).catch(() => {
        window.open(item.url, '_blank');
      });
    } else {
      window.open(item.url, '_blank');
    }
  }

  updateCount() {
    const counts = this.mediaStore.getCounts();
    this.countEl.innerHTML = `<span style="font-size: 14px; margin-left: 4px;">(${counts.total})</span> <span style="font-size: 12px; font-weight: normal; color: #71767b; margin-left: 4px;">图片 ${counts.photos} 视频 ${counts.videos} 已下 ${counts.downloaded} 未下 ${counts.notDownloaded}</span>`;
  }

  updateSelectionUI() {
    const allSelected = this.mediaStore.mediaMap.size > 0 &&
      this.mediaStore.selectedIds.size === this.mediaStore.mediaMap.size;
    this.selectAllBtn.textContent = allSelected ? '取消全选' : '全选';
    this.downloadSelectedBtn.disabled = this.mediaStore.selectedIds.size === 0;
  }
}

new SidePanelApp();
