import MediaStore from './MediaStore';
import MediaGridRenderer from './MediaGridRenderer';
import { ICON_FOLDER, ICON_SHIELD, ICON_ALERT } from './constants';
import { computePHash } from './phash';

const CATEGORY_LABELS = { '': '默认', real: '真人', anime: '动漫' };

class SidePanelApp {
  constructor() {
    this.mediaStore = new MediaStore();
    this.renderer = new MediaGridRenderer(this.mediaStore);
    this.port = null;
    this.portReconnectTimer = null;
    this.bossMode = false;
    this.connected = false;
    this.sessionStats = { captured: 0, downloaded: 0, photos: 0, videos: 0 };

    this.cacheElements();
    this.bindEvents();
    this.listenForMessages();
    this.connectPort();
    this.loadSettings();
  }

  cacheElements() {
    this.selectAllBtn = document.getElementById('x-select-all-btn');
    this.downloadSelectedBtn = document.getElementById('x-download-selected-btn');
    this.deleteSelectedBtn = document.getElementById('x-delete-selected-btn');
    this.downloadCategorySelect = document.getElementById('x-download-category');
    this.clearBtn = document.getElementById('x-clear-btn');
    this.countEl = document.getElementById('x-count');
    this.emptyState = document.getElementById('x-empty-state');
    this.filterBtns = document.querySelectorAll('.x-filter-btn');
    this.fullViewToggle = document.getElementById('x-full-view-toggle');
    this.clickOpenToggle = document.getElementById('x-click-open-toggle');
    this.bossKeyBtn = document.getElementById('x-boss-key-btn');
    this.bossOverlay = document.getElementById('x-boss-overlay');
    this.statusConnection = document.getElementById('x-status-connection');
    this.statusCategory = document.getElementById('x-status-category');
    this.statusBoss = document.getElementById('x-status-boss');
    this.statsBtn = document.getElementById('x-stats-btn');
    this.statsPanel = document.getElementById('x-stats-panel');
    this.statsClose = document.getElementById('x-stats-close');
    this.settingsBtn = document.getElementById('x-settings-btn');
    this.settingsPanel = document.getElementById('x-settings-panel');
    this.settingsClose = document.getElementById('x-settings-close');
    this.dedupByThumbToggle = document.getElementById('x-dedup-by-thumb');
    this.dedupByPhashToggle = document.getElementById('x-dedup-by-phash');
    this.usePresetsToggle = document.getElementById('x-use-presets');
    this.presetConfig = document.getElementById('x-preset-config');
    this.cat1Label = document.getElementById('x-cat-1-label');
    this.cat1Folder = document.getElementById('x-cat-1-folder');
    this.cat2Label = document.getElementById('x-cat-2-label');
    this.cat2Folder = document.getElementById('x-cat-2-folder');
    this.presetSaveBtn = document.getElementById('x-preset-save-btn');
  }

  async loadSettings() {
    try {
      const settings = await chrome.runtime.sendMessage({ action: 'get_settings' });
      if (settings) {
        if (this.dedupByThumbToggle) {
          this.dedupByThumbToggle.checked = !!settings.dedupByThumb;
        }
        if (this.dedupByPhashToggle) {
          this.dedupByPhashToggle.checked = !!settings.dedupByPhash;
        }
        if (this.clickOpenToggle) {
          this.clickOpenToggle.checked = !!settings.clickToOpen;
          this.renderer.setClickToOpen(this.clickOpenToggle.checked);
        }
        if (this.fullViewToggle) {
          this.fullViewToggle.checked = !!settings.fullViewMode;
          document.body.classList.toggle('full-view-mode', this.fullViewToggle.checked);
        }
        // 加载预设配置
        const usePresets = settings.usePresets !== false;
        if (this.usePresetsToggle) {
          this.usePresetsToggle.checked = usePresets;
          this.presetConfig.classList.toggle('hidden', !usePresets);
        }
        const categories = settings.customCategories || [
          { value: 'real', label: '真人' },
          { value: 'anime', label: '动漫' }
        ];
        this.currentCategories = categories;
        this.renderer.setCategories(usePresets, categories);
        // 填充输入框
        if (categories[0]) {
          this.cat1Label.value = categories[0].label || '';
          this.cat1Folder.value = (settings.categoryFolders && settings.categoryFolders[categories[0].value]) || '';
        }
        if (categories[1]) {
          this.cat2Label.value = categories[1].label || '';
          this.cat2Folder.value = (settings.categoryFolders && settings.categoryFolders[categories[1].value]) || '';
        }
        // 更新顶部下拉框
        this.updateCategorySelect(usePresets, categories, settings.categoryFolders);
      }
    } catch (e) {}
  }

  updateCategorySelect(usePresets, categories, categoryFolders) {
    this.downloadCategorySelect.innerHTML = '';
    if (usePresets && categories && categories.length > 0) {
      categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.value;
        opt.textContent = cat.label;
        this.downloadCategorySelect.appendChild(opt);
      });
    } else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '默认';
      this.downloadCategorySelect.appendChild(opt);
    }
  }

  async updateSettings(patch) {
    try {
      await chrome.runtime.sendMessage({
        action: 'update_settings',
        settings: patch
      });
    } catch (e) {}
  }

  getCurrentCategories() {
    // 使用已存储的 categories（value 与 categoryFolders 映射一致）
    return this.currentCategories || [
      { value: 'real', label: '真人' },
      { value: 'anime', label: '动漫' }
    ];
  }

  async saveCustomPresets() {
    const label1 = this.cat1Label.value.trim();
    const folder1 = this.cat1Folder.value.trim();
    const label2 = this.cat2Label.value.trim();
    const folder2 = this.cat2Folder.value.trim();

    if (!label1 || !folder1 || !label2 || !folder2) {
      this.showInfoToast('请填写完整的显示名和文件夹名');
      return;
    }

    const categories = [
      { value: 'cat1', label: label1 },
      { value: 'cat2', label: label2 }
    ];
    const categoryFolders = {
      cat1: folder1,
      cat2: folder2
    };

    await this.updateSettings({ customCategories: categories, categoryFolders });
    this.currentCategories = categories;
    this.renderer.setCategories(true, categories);
    this.updateCategorySelect(true, categories, categoryFolders);
    this.showInfoToast('预设已保存');
  }

  bindEvents() {
    this.renderer.onDownload = (items, category) => this.downloadItems(items, category != null ? category : this.downloadCategorySelect.value);
    this.renderer.onShowLightbox = (item) => this.showLightbox(item);
    this.renderer.onOpenUrl = (item) => this.openTweetUrl(item);
    this.renderer.onDeleteItem = (ids) => this.deleteItems(ids);

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
      this.updateSettings({ fullViewMode: e.target.checked });
    });

    if (this.clickOpenToggle) {
      this.clickOpenToggle.addEventListener('change', (e) => {
        this.renderer.setClickToOpen(e.target.checked);
        this.updateSettings({ clickToOpen: e.target.checked });
      });
    }

    if (this.usePresetsToggle) {
      this.usePresetsToggle.addEventListener('change', (e) => {
        this.presetConfig.classList.toggle('hidden', !e.target.checked);
        const usePresets = e.target.checked;
        this.updateSettings({ usePresets });
        // 立即刷新渲染
        const categories = this.getCurrentCategories();
        this.renderer.setCategories(usePresets, categories);
        this.updateCategorySelect(usePresets, categories, null);
      });
    }

    if (this.presetSaveBtn) {
      this.presetSaveBtn.addEventListener('click', () => this.saveCustomPresets());
    }

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

    if (this.deleteSelectedBtn) {
      this.deleteSelectedBtn.addEventListener('click', () => {
        const items = this.mediaStore.getSelectedItems();
        if (items.length === 0) return;
        const ids = items.map(i => i.id);
        this.deleteItems(ids);
      });
    }

    this.clearBtn.addEventListener('click', () => {
      this.mediaStore.clear();
      this.renderer.grid.innerHTML = '';
      this.updateCount();
      this.updateSelectionUI();
      this.emptyState.style.display = 'block';
    });

    this.bossKeyBtn.addEventListener('click', () => this.toggleBossMode());

    // 右键任意位置触发隐私模式（快速反应）
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.toggleBossMode();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.statsPanel.classList.contains('open')) {
          this.closeStats();
        } else if (this.settingsPanel && this.settingsPanel.classList.contains('open')) {
          this.closeSettings();
        } else {
          this.toggleBossMode();
        }
      }
    });

    this.downloadCategorySelect.addEventListener('change', () => {
      this.updateStatusCategory();
    });

    this.statsBtn.addEventListener('click', () => this.toggleStats());
    this.statsClose.addEventListener('click', () => this.closeStats());

    if (this.settingsBtn) {
      this.settingsBtn.addEventListener('click', () => this.toggleSettings());
    }
    if (this.settingsClose) {
      this.settingsClose.addEventListener('click', () => this.closeSettings());
    }
    if (this.dedupByThumbToggle) {
      this.dedupByThumbToggle.addEventListener('change', (e) => {
        this.updateSettings({ dedupByThumb: e.target.checked });
        if (e.target.checked) {
          this.showInfoToast('已开启封面去重，新下载会按封面识别重复');
        } else {
          this.showInfoToast('已关闭封面去重');
        }
      });
    }
    if (this.dedupByPhashToggle) {
      this.dedupByPhashToggle.addEventListener('change', (e) => {
        this.updateSettings({ dedupByPhash: e.target.checked });
        if (e.target.checked) {
          this.showInfoToast('已开启感知哈希去重，能识别盗图/压缩图/截图');
          // 重新检查现有媒体
          setTimeout(() => this.checkHistoryForNewItems(), 500);
        } else {
          this.showInfoToast('已关闭感知哈希去重');
        }
      });
    }
  }

  toggleSettings() {
    if (this.settingsPanel.classList.contains('open')) {
      this.closeSettings();
    } else {
      this.openSettings();
    }
  }

  openSettings() {
    this.settingsPanel.classList.add('open');
    this.loadSettings();
  }

  closeSettings() {
    this.settingsPanel.classList.remove('open');
  }

  showInfoToast(text) {
    const existing = document.querySelector('.x-duplicate-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'x-duplicate-toast';
    toast.style.background = 'rgba(29, 155, 240, 0.92)';
    toast.style.color = '#fff';
    toast.textContent = text;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  toggleBossMode() {
    this.bossMode = !this.bossMode;
    this.bossOverlay.classList.toggle('active', this.bossMode);
    this.bossKeyBtn.classList.toggle('boss-active', this.bossMode);
    this.statusBoss.style.display = this.bossMode ? 'inline-flex' : 'none';
    if (this.bossMode) {
      this.statusBoss.innerHTML = `${ICON_SHIELD} 隐私模式`;
    }
  }

  toggleStats() {
    if (this.statsPanel.classList.contains('open')) {
      this.closeStats();
    } else {
      this.openStats();
    }
  }

  openStats() {
    this.statsPanel.classList.add('open');
    this.loadStats();
  }

  closeStats() {
    this.statsPanel.classList.remove('open');
  }

  async loadStats() {
    try {
      const stats = await chrome.runtime.sendMessage({ action: 'get_stats' });
      if (stats) {
        this.renderStats(stats);
      }
    } catch (e) {}
  }

  renderStats(stats) {
    document.getElementById('x-stat-total').textContent = stats.total;
    document.getElementById('x-stat-photos').textContent = stats.photos;
    document.getElementById('x-stat-videos').textContent = stats.videos;

    this.renderHeatmap(stats);

    const counts = this.mediaStore.getCounts();
    const sessionEl = document.getElementById('x-stats-session');
    sessionEl.innerHTML = `
      <div class="x-session-row"><span>捕获媒体</span><span>${counts.total}</span></div>
      <div class="x-session-row"><span>已下载</span><span>${counts.downloaded}</span></div>
      <div class="x-session-row"><span>未下载</span><span>${counts.notDownloaded}</span></div>
      <div class="x-session-row"><span>图片</span><span>${counts.photos}</span></div>
      <div class="x-session-row"><span>视频</span><span>${counts.videos}</span></div>
    `;
  }

  renderHeatmap(stats) {
    const grid = document.getElementById('x-heatmap-grid');
    const monthsEl = document.getElementById('x-heatmap-months');
    const maxCount = stats.maxCount || 1;

    // 月份标签
    const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    monthsEl.innerHTML = stats.monthLabels.map(m => {
      if (!m) return '<span class="x-heatmap-month-spacer"></span>';
      return `<span class="x-heatmap-month">${MONTH_NAMES[m.month]}</span>`;
    }).join('');

    // 格子
    grid.innerHTML = stats.weeks.map(week => {
      const cells = week.map(day => {
        if (day.future) {
          return `<span class="x-heatmap-cell future" data-date="${day.date}" data-count="0"></span>`;
        }
        const level = day.count === 0 ? 0
          : day.count <= maxCount * 0.25 ? 1
          : day.count <= maxCount * 0.5 ? 2
          : day.count <= maxCount * 0.75 ? 3
          : 4;
        return `<span class="x-heatmap-cell l${level}" data-date="${day.date}" data-count="${day.count}"></span>`;
      }).join('');
      return `<div class="x-heatmap-col">${cells}</div>`;
    }).join('');

    // 悬浮提示
    this.bindHeatmapTooltip(grid);
  }

  bindHeatmapTooltip(grid) {
    let tooltip = document.getElementById('x-heatmap-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'x-heatmap-tooltip';
      tooltip.className = 'x-heatmap-tooltip';
      document.body.appendChild(tooltip);
    }

    grid.addEventListener('mouseover', (e) => {
      const cell = e.target.closest('.x-heatmap-cell');
      if (!cell || cell.classList.contains('future')) return;

      const date = cell.dataset.date;
      const count = cell.dataset.count;
      tooltip.innerHTML = `<strong>${count} 次下载</strong><br>${date}`;
      tooltip.classList.add('visible');
    });

    grid.addEventListener('mousemove', (e) => {
      if (!tooltip.classList.contains('visible')) return;
      const x = e.clientX;
      const y = e.clientY;
      const tw = tooltip.offsetWidth;
      const th = tooltip.offsetHeight;
      tooltip.style.left = `${x - tw / 2}px`;
      tooltip.style.top = `${y - th - 10}px`;
    });

    grid.addEventListener('mouseout', (e) => {
      const cell = e.target.closest('.x-heatmap-cell');
      if (cell) {
        tooltip.classList.remove('visible');
      }
    });
  }

  updateConnectionStatus(connected) {
    this.connected = connected;
    const dot = this.statusConnection.querySelector('.x-status-dot');
    const label = this.statusConnection.querySelector('span:last-child');
    if (connected) {
      dot.className = 'x-status-dot x-status-dot-connected';
      label.textContent = '采集中';
    } else {
      dot.className = 'x-status-dot x-status-dot-disconnected';
      label.textContent = '已断开';
    }
  }

  updateStatusCategory() {
    const value = this.downloadCategorySelect.value;
    const label = CATEGORY_LABELS[value] || value;
    this.statusCategory.innerHTML = `${ICON_FOLDER} ${label}`;
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
      this.updateConnectionStatus(true);

      this.port.onMessage.addListener((message) => {
        if (message.event === 'media_intercepted') {
          this.handleMediaItems(message.items, message.tabId);
        }
      });
      this.port.onDisconnect.addListener(() => {
        this.port = null;
        this.updateConnectionStatus(false);
        this.schedulePortReconnect();
      });
    } catch (e) {
      this.port = null;
      this.updateConnectionStatus(false);
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

      // 异步计算 pHash（如果开启）
      this.computePhashForItems(items);
    }
  }

  async computePhashForItems(items) {
    try {
      const settings = await chrome.runtime.sendMessage({ action: 'get_settings' });
      if (!settings || !settings.dedupByPhash) return;

      // 只对图片计算 pHash（视频用封面图）
      const photoItems = items.filter(i => i.type === 'photo' || i.type === 'video' || i.type === 'animated_gif');
      let phashChanged = false;
      for (const item of photoItems) {
        const thumbUrl = item.thumb || item.url;
        const phash = await computePHash(thumbUrl);
        if (phash) {
          const storeItem = this.mediaStore.getItem(item.id);
          if (storeItem) {
            storeItem.phash = phash;
            phashChanged = true;
          }
        }
      }

      // pHash 计算完成后，重新检查历史（此时才有 phash 可比对）
      if (phashChanged) {
        await this.checkHistoryForNewItems();
      }
    } catch (e) {}
  }

  async checkHistoryForNewItems() {
    const allItems = this.mediaStore.getAllItems();
    const allIds = allItems.map(i => i.id);
    if (allIds.length === 0) return;

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'check_history',
        ids: allIds,
        items: allItems
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
          // 重新渲染以显示已下载状态
          this.renderer.render();
        }
      }
    } catch (e) {}
  }

  async downloadItems(items, category = '') {
    try {
      // 附加 pHash（如果已计算）
      const itemsWithPhash = items.map(item => {
        const storeItem = this.mediaStore.getItem(item.id);
        return storeItem && storeItem.phash ? { ...item, phash: storeItem.phash } : item;
      });

      const result = await chrome.runtime.sendMessage({
        action: 'download_media',
        items: itemsWithPhash,
        category: category
      });

      if (result) {
        if (result.downloaded && result.downloaded.length > 0) {
          this.mediaStore.markDownloaded(result.downloaded);
          result.downloaded.forEach(id => {
            this.renderer.markItemDownloaded(id);
          });
          this.mediaStore.clearSelection();
          this.renderer.updateAllItemSelections();
        }

        if (result.duplicates && result.duplicates.length > 0) {
          this.showDuplicateToast(result.duplicates.length);
          result.duplicates.forEach(id => {
            this.mediaStore.markDownloaded(id);
            this.renderer.markItemDownloaded(id);
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
    toast.innerHTML = `<span class="x-toast-icon">${ICON_ALERT}</span> ${count} 个文件已下载过，已跳过重复下载`;
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

  openTweetUrl(item) {
    // 直接在新标签页打开媒体本身（类似右键图片"在新标签页打开"）
    if (item.url) {
      window.open(item.url, '_blank');
    }
  }

  deleteItems(ids) {
    if (!ids || ids.length === 0) return;
    this.mediaStore.removeItems(ids);
    this.renderer.removeItems(ids);
    this.updateCount();
    this.updateSelectionUI();
    if (this.mediaStore.getAllItems().length === 0) {
      this.emptyState.style.display = 'block';
    }
    this.showInfoToast(`已删除 ${ids.length} 项`);
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
