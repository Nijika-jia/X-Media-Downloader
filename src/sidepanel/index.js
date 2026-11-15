import MediaStore from './MediaStore';
import MediaGridRenderer from './MediaGridRenderer';
import { ICON_FOLDER, ICON_SHIELD, ICON_ALERT } from './constants';
import { computeHashes } from './phash';

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
    this.loadCapturedItems();
    this.loadStagedItems();
  }

  cacheElements() {
    this.selectAllBtn = document.getElementById('x-select-all-btn');
    this.downloadSelectedBtn = document.getElementById('x-download-selected-btn');
    this.deleteSelectedBtn = document.getElementById('x-delete-selected-btn');
    this.downloadCategorySelect = document.getElementById('x-download-category');
    this.clearBtn = document.getElementById('x-clear-btn');
    this.countEl = document.getElementById('x-count');
    this.emptyState = document.getElementById('x-empty-state');
    this.mediaGrid = document.getElementById('x-media-grid');
    this.selectionBar = document.getElementById('x-selection-bar');
    this.selectionCount = document.getElementById('x-selection-count');
    this.selectionActions = document.getElementById('x-selection-actions');
    this.selectionClear = document.getElementById('x-selection-clear');
    this.typeFilterBtns = document.querySelectorAll('#x-type-filter .x-filter-btn');
    this.statusFilterBtns = document.querySelectorAll('#x-status-filter .x-filter-btn');
    this.typeFilter = 'all';
    this.statusFilter = 'all';
    this.fullViewToggle = document.getElementById('x-full-view-toggle');
    this.hideStagedToggle = document.getElementById('x-hide-staged-toggle');
    this.clickOpenToggle = document.getElementById('x-click-open-toggle');
    this.bossKeyBtn = document.getElementById('x-boss-key-btn');
    this.refreshBtn = document.getElementById('x-refresh-btn');
    this.bossOverlay = document.getElementById('x-boss-overlay');
    this.statusConnection = document.getElementById('x-status-connection');
    this.statusCategory = document.getElementById('x-status-category');
    this.statusDownloads = document.getElementById('x-status-downloads');
    this.statusStaged = document.getElementById('x-status-staged');
    this.statusBoss = document.getElementById('x-status-boss');
    this.statsBtn = document.getElementById('x-stats-btn');
    this.downloadCenterBtn = document.getElementById('x-download-center-btn');
    this.statsPanel = document.getElementById('x-stats-panel');
    this.statsClose = document.getElementById('x-stats-close');
    this.settingsBtn = document.getElementById('x-settings-btn');
    this.settingsPanel = document.getElementById('x-settings-panel');
    this.settingsClose = document.getElementById('x-settings-close');
    this.dedupByThumbToggle = document.getElementById('x-dedup-by-thumb');
    this.dedupByPhashToggle = document.getElementById('x-dedup-by-phash');
    this.hoverAutoplayToggle = document.getElementById('x-hover-autoplay');
    this.usePresetsToggle = document.getElementById('x-use-presets');
    this.presetConfig = document.getElementById('x-preset-config');
    this.cat1Label = document.getElementById('x-cat-1-label');
    this.cat1Folder = document.getElementById('x-cat-1-folder');
    this.cat2Label = document.getElementById('x-cat-2-label');
    this.cat2Folder = document.getElementById('x-cat-2-folder');
    this.presetSaveBtn = document.getElementById('x-preset-save-btn');
    this.exportBtn = document.getElementById('x-export-btn');
    this.importBtn = document.getElementById('x-import-btn');
    this.importFileInput = document.getElementById('x-import-file-input');
    this.zipBtn = document.getElementById('x-zip-btn');
    this.zipBadge = document.getElementById('x-zip-badge');
    this.unstageBtn = document.getElementById('x-unstage-btn');
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
        const hoverAutoplay = settings.hoverAutoplay !== false;
        if (this.hoverAutoplayToggle) {
          this.hoverAutoplayToggle.checked = hoverAutoplay;
        }
        this.renderer.setHoverAutoplay(hoverAutoplay);

        this.gridCardSize = Number(settings.gridCardSize) || 0;
        this.applyGridSize();
        if (this.clickOpenToggle) {
          this.clickOpenToggle.checked = !!settings.clickToOpen;
          this.renderer.setClickToOpen(this.clickOpenToggle.checked);
        }
        if (this.fullViewToggle) {
          this.fullViewToggle.checked = !!settings.fullViewMode;
          document.body.classList.toggle('full-view-mode', this.fullViewToggle.checked);
        }
        if (this.hideStagedToggle) {
          this.hideStagedToggle.checked = !!settings.hideStaged;
          this.renderer.setHideStaged(this.hideStagedToggle.checked);
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

  async loadCapturedItems() {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'get_captured_media' });
      if (result && Array.isArray(result.items) && result.items.length > 0) {
        await this.handleMediaItems(result.items, null);
      } else {
        await this.restoreDownloadStates();
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
    this.renderer.onStage = (item, category) => this.toggleStageItem(item, category);
    this.renderer.onShowLightbox = (item) => this.showLightbox(item);
    this.renderer.onOpenUrl = (item) => this.openTweetUrl(item);
    this.renderer.onDeleteItem = (ids) => this.deleteItems(ids);

    this.mediaStore.addListener((event) => {
      this.updateCount();
      this.updateSelectionUI();
    });

    const bindFilterGroup = (groupBtns, onSelect) => {
      groupBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          groupBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          onSelect(btn.dataset.filter);
          this.renderer.setFilter(this.typeFilter, this.statusFilter);
          this.updateCount();
          this.updateUnstageBtnVisibility();
        });
      });
    };

    bindFilterGroup(this.typeFilterBtns, (value) => { this.typeFilter = value; });
    bindFilterGroup(this.statusFilterBtns, (value) => { this.statusFilter = value; });

    this.fullViewToggle.addEventListener('change', (e) => {
      document.body.classList.toggle('full-view-mode', e.target.checked);
      this.updateSettings({ fullViewMode: e.target.checked });
    });

    if (this.hideStagedToggle) {
      this.hideStagedToggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        // 与「已暂存」筛选互斥：开启隐藏时状态筛选重置为「不限」
        if (enabled && this.statusFilter === 'staged') {
          this.statusFilter = 'all';
          this.statusFilterBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === 'all');
          });
          this.renderer.setFilter(this.typeFilter, this.statusFilter);
          this.updateUnstageBtnVisibility();
        }
        this.renderer.setHideStaged(enabled);
        this.updateSettings({ hideStaged: enabled });
        this.updateCount();
      });
    }

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

    if (this.zipBtn) {
      this.zipBtn.addEventListener('click', () => this.packStagedItems());
    }

    if (this.exportBtn) {
      this.exportBtn.addEventListener('click', () => this.exportMediaList());
    }

    if (this.importBtn) {
      this.importBtn.addEventListener('click', () => {
        console.log('[X-Media] 导入按钮被点击', this.importFileInput);
        if (this.importFileInput) {
          this.importFileInput.click();
        } else {
          console.error('[X-Media] importFileInput 为 null');
        }
      });
    }

    if (this.importFileInput) {
      this.importFileInput.addEventListener('change', (e) => this.handleImportFile(e));
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

    if (this.unstageBtn) {
      this.unstageBtn.addEventListener('click', () => this.unstageSelected());
    }

    this.clearBtn.addEventListener('click', () => {
      this.mediaStore.clear();
      this.mediaStore.applyStaged([]);
      this.renderer.grid.innerHTML = '';
      this.updateCount();
      this.updateSelectionUI();
      this.updateStagedStatus();
      this.emptyState.style.display = 'block';
      chrome.runtime.sendMessage({ action: 'clear_captured_media' }).catch(() => {});
      chrome.runtime.sendMessage({ action: 'clear_staged_media' }).catch(() => {});
    });

    this.bossKeyBtn.addEventListener('click', () => this.toggleBossMode());

    if (this.refreshBtn) {
      this.refreshBtn.addEventListener('click', () => this.refreshDownloadState());
    }

    // 仅在媒体网格区域右键触发隐私模式（快速反应），其余区域保留正常右键菜单（复制/查看图片等）
    const mediaGrid = document.getElementById('x-media-grid');
    if (mediaGrid) {
      mediaGrid.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.toggleBossMode();
      });
    }

    this.setupBoxSelection();

    if (this.selectionClear) {
      this.selectionClear.addEventListener('click', () => {
        this.mediaStore.clearSelection();
        this.renderer.updateAllItemSelections();
      });
    }

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

    if (this.downloadCenterBtn) {
      this.downloadCenterBtn.addEventListener('click', () => this.openDownloadCenter());
    }

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

    if (this.hoverAutoplayToggle) {
      this.hoverAutoplayToggle.addEventListener('change', (e) => {
        this.renderer.setHoverAutoplay(e.target.checked);
        this.updateSettings({ hoverAutoplay: e.target.checked });
      });
    }

    // 卡片大小：+ / - 缩放，0 恢复自动适配
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      if (target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) return;

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        this.adjustGridSize(20);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        this.adjustGridSize(-20);
      } else if (e.key === '0') {
        e.preventDefault();
        this.resetGridSize();
      }
    });
  }

  // ===== 卡片大小 =====

  applyGridSize() {
    if (this.gridCardSize > 0) {
      document.documentElement.style.setProperty('--x-card-min', `${this.gridCardSize}px`);
    } else {
      document.documentElement.style.removeProperty('--x-card-min');
    }
  }

  adjustGridSize(delta) {
    let base = this.gridCardSize;
    if (!base) {
      const first = this.mediaGrid ? this.mediaGrid.querySelector('.x-media-item') : null;
      base = first ? Math.round(first.getBoundingClientRect().width) : 160;
    }
    const next = Math.max(80, Math.min(420, base + delta));
    this.gridCardSize = next;
    this.applyGridSize();
    this.updateSettings({ gridCardSize: next });
    this.showInfoToast(`卡片大小：${next}px（按 0 恢复自动）`);
  }

  resetGridSize() {
    this.gridCardSize = 0;
    this.applyGridSize();
    this.updateSettings({ gridCardSize: 0 });
    this.showInfoToast('卡片大小已恢复自动适配');
  }

  // ===== 鼠标框选 =====

  setupBoxSelection() {
    const grid = this.mediaGrid;
    if (!grid) return;

    let startX = 0;
    let startY = 0;
    let dragging = false;
    let boxEl = null;

    const isInteractiveTarget = (target) => {
      return !!target.closest('button, video, input, select, .x-item-btn, .x-inline-play, .x-dl-actions');
    };

    const onMouseMove = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return;
        dragging = true;
        document.body.classList.add('x-box-selecting');
        boxEl = document.createElement('div');
        boxEl.className = 'x-selection-box';
        document.body.appendChild(boxEl);
      }
      const rect = this.getBoxRect(startX, startY, ev.clientX, ev.clientY);
      boxEl.style.left = `${rect.left}px`;
      boxEl.style.top = `${rect.top}px`;
      boxEl.style.width = `${rect.right - rect.left}px`;
      boxEl.style.height = `${rect.bottom - rect.top}px`;
      this.highlightBoxHits(rect);
    };

    const onMouseUp = (ev) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.classList.remove('x-box-selecting');
      if (boxEl) {
        boxEl.remove();
        boxEl = null;
      }
      if (!dragging) return;

      // 拖动结束后吞掉一次点击，避免误触缩略图或卡片按钮
      this._suppressClickUntil = Date.now() + 120;
      const rect = this.getBoxRect(startX, startY, ev.clientX, ev.clientY);
      const hits = this.getBoxHits(rect);
      this.applyBoxSelection(hits, ev.ctrlKey || ev.metaKey || ev.shiftKey);
    };

    grid.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (isInteractiveTarget(e.target)) return;
      startX = e.clientX;
      startY = e.clientY;
      dragging = false;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    grid.addEventListener('click', (e) => {
      if (this._suppressClickUntil && Date.now() < this._suppressClickUntil) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    // 防止图片原生拖拽打断框选
    grid.addEventListener('dragstart', (e) => e.preventDefault());
  }

  getBoxRect(x1, y1, x2, y2) {
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      right: Math.max(x1, x2),
      bottom: Math.max(y1, y2)
    };
  }

  getBoxHits(rect) {
    const hits = [];
    this.mediaGrid.querySelectorAll('.x-media-item').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top) {
        hits.push(el.dataset.id);
      }
    });
    return hits;
  }

  highlightBoxHits(rect) {
    const hitSet = new Set(this.getBoxHits(rect));
    this.mediaGrid.querySelectorAll('.x-media-item').forEach(el => {
      el.classList.toggle('box-selected', hitSet.has(el.dataset.id));
    });
  }

  applyBoxSelection(ids, additive) {
    this.mediaGrid.querySelectorAll('.x-media-item.box-selected').forEach(el => {
      el.classList.remove('box-selected');
    });
    if (!additive) {
      this.mediaStore.selectedIds.clear();
    }
    ids.forEach(id => this.mediaStore.selectedIds.add(id));
    if (ids.length > 0) {
      this.mediaStore.lastSelectedId = ids[ids.length - 1];
    }
    this.mediaStore.notifyListeners('selection_changed');
    this.renderer.updateAllItemSelections();
  }

  updateSelectionBar() {
    if (!this.selectionBar) return;
    const count = this.mediaStore.selectedIds.size;
    this.selectionBar.hidden = count === 0;
    if (count === 0) return;
    this.selectionCount.textContent = `已选 ${count} 项`;
    this.renderSelectionActions();
  }

  renderSelectionActions() {
    if (!this.selectionActions) return;
    const usePresets = this.renderer.usePresets && this.renderer.categories.length > 0;
    const categories = usePresets
      ? this.renderer.categories
      : [{ value: '', label: '暂存' }];

    this.selectionActions.innerHTML = '';
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'x-selection-btn';
      btn.textContent = cat.label;
      btn.title = `把选中的项暂存到${cat.label}`;
      btn.addEventListener('click', () => this.stageSelectedItems(cat.value));
      this.selectionActions.appendChild(btn);
    });
  }

  async stageSelectedItems(category) {
    const items = this.mediaStore.getSelectedItems();
    if (items.length === 0) return;

    const payload = items.map(item => {
      const storeItem = this.mediaStore.getItem(item.id);
      if (!storeItem || (!storeItem.phash && !storeItem.dhash)) return item;
      return { ...item, phash: storeItem.phash, dhash: storeItem.dhash };
    });

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'stage_media_batch',
        items: payload,
        category: category == null ? '' : category
      });
      if (!result || !result.ok) {
        this.showInfoToast('批量暂存失败，请稍后重试');
        return;
      }
      this.mediaStore.setStagedMany(payload, category);
      this.mediaStore.clearSelection();
      this.renderer.render();
      this.updateSelectionUI();
      this.updateStagedStatus();
      this.updateCount();
      this.showInfoToast(`已将 ${payload.length} 项暂存`);
    } catch (e) {
      this.showInfoToast('批量暂存失败，请稍后重试');
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

  openDownloadCenter() {
    // 通过 background 打开/复用下载中心标签页（chrome.tabs.create）
    chrome.runtime.sendMessage({ action: 'dc_open_tab' });
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
      if (message.action === 'dc_task_update' && message.task) {
        const id = String(message.task.id);
        if (message.task.status === 'pending' || message.task.status === 'downloading' || message.task.status === 'retrying') {
          const state = message.task.status === 'pending' ? 'queued' : message.task.status;
          this.mediaStore.markDownloading([id], state);
          this.renderer.markItemDownloading(id, state);
        } else if (message.task.status === 'completed') {
          this.mediaStore.markDownloaded([id]);
          this.renderer.markItemDownloaded(id);
        } else if (message.task.status === 'failed') {
          this.mediaStore.markNotDownloaded([id]);
          this.renderer.markItemNotDownloaded(id);
          this.showInfoToast('下载失败，可在下载中心手动重试');
        }
      }
      if (message.action === 'zip_batch_completed' && Array.isArray(message.ids)) {
        this.mediaStore.markDownloaded(message.ids);
        message.ids.forEach(id => {
          this.renderer.markItemDownloaded(id);
          this.mediaStore.setStaged(id, null);
        });
        this.updateStagedStatus();
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
      // 先尝试从缓存加载已有 pHash（避免重新计算）
      await this.loadCachedPhash(items);
      await this.checkHistoryForNewItems();
      this.renderer.render();
      await this.restoreDownloadStates();
      this.emptyState.style.display = 'none';

      // 异步计算缺失的 pHash（如果开启）
      this.computePhashForItems(items);
    }
  }

  async restoreDownloadStates() {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'dc_get_tasks' });
      const activeTasks = result && Array.isArray(result.tasks)
        ? result.tasks.filter(task => ['pending', 'downloading', 'retrying'].includes(task.status))
        : [];
      const activeIds = new Set(activeTasks.map(task => String(task.id)));
      this.mediaStore.getAllItems().forEach(item => {
        if (item.downloading && !activeIds.has(String(item.id))) {
          this.mediaStore.markNotDownloaded([item.id]);
          this.renderer.markItemNotDownloaded(item.id);
        }
      });

      activeTasks.forEach(task => {
        const id = String(task.id);
        if (!this.mediaStore.getItem(id)) return;
        const state = task.status === 'pending' ? 'queued' : task.status;
        this.mediaStore.markDownloading([id], state);
        this.renderer.markItemDownloading(id, state);
      });
    } catch (e) {
      // 下载中心不可用时保留本地即时状态，下一次消息或手动刷新会再次同步。
    }
  }

  /**
   * 从后台 pHash 缓存加载已计算的值，避免重复计算
   */
  async loadCachedPhash(items) {
    try {
      const ids = items.map(i => i.id);
      const cached = await chrome.runtime.sendMessage({ action: 'get_phash_cache', ids });
      if (cached) {
        let changed = false;
        for (const id in cached) {
          const storeItem = this.mediaStore.getItem(id);
          if (!storeItem) continue;
          const entry = cached[id];
          const phash = typeof entry === 'string' ? entry : (entry && entry.phash);
          const dhash = entry && typeof entry === 'object' ? entry.dhash : null;
          if (!storeItem.phash && phash) {
            storeItem.phash = phash;
            changed = true;
          }
          if (!storeItem.dhash && dhash) {
            storeItem.dhash = dhash;
            changed = true;
          }
        }
        return changed;
      }
    } catch (e) {}
    return false;
  }

  async computePhashForItems(items) {
    try {
      const settings = await chrome.runtime.sendMessage({ action: 'get_settings' });
      if (!settings || !settings.dedupByPhash) return;

      // 只对图片计算哈希（视频用封面图），aHash 或 dHash 任一缺失都需要重算
      const photoItems = items.filter(i =>
        (i.type === 'photo' || i.type === 'video' || i.type === 'animated_gif') &&
        (!i.phash || !i.dhash)
      );
      if (photoItems.length === 0) return;

      const computedItems = [];
      let phashChanged = false;
      for (const item of photoItems) {
        const thumbUrl = item.thumb || item.url;
        const hashes = await computeHashes(thumbUrl);
        if (hashes) {
          const storeItem = this.mediaStore.getItem(item.id);
          if (storeItem) {
            storeItem.phash = hashes.phash;
            storeItem.dhash = hashes.dhash;
            phashChanged = true;
            computedItems.push({ id: item.id, phash: hashes.phash, dhash: hashes.dhash });
          }
        }
      }

      // 持久化到后台缓存（下次打开侧边栏不用重新计算）
      if (computedItems.length > 0) {
        try {
          await chrome.runtime.sendMessage({ action: 'update_phash_cache', items: computedItems });
        } catch (e) {}
      }

      // pHash 计算完成后，重新检查历史（此时才有 phash 可比对）
      if (phashChanged) {
        await this.checkHistoryForNewItems();
      }
    } catch (e) {}
  }

  async checkHistoryForNewItems({ render = false } = {}) {
    const allItems = this.mediaStore.getAllItems();
    const allIds = allItems.map(i => i.id);
    if (allIds.length === 0) return false;

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
        this.mediaStore.syncDownloaded(downloadedIds);
        if (render) this.renderer.render();
        return true;
      }
    } catch (e) {}
    return false;
  }

  async refreshDownloadState() {
    const refreshed = await this.checkHistoryForNewItems({ render: true });
    await this.restoreDownloadStates();
    if (refreshed) {
      this.emptyState.style.display = this.mediaStore.getAllItems().length > 0 ? 'none' : 'block';
      this.updateCount();
      this.showInfoToast('下载状态已刷新');
    } else {
      this.updateCount();
      this.showInfoToast('下载任务状态已刷新');
    }
  }

  async downloadItems(items, category = '') {
    const requestItems = [];
    const activeIds = [];
    const downloadedIds = [];
    const seenIds = new Set();

    (Array.isArray(items) ? items : []).forEach(item => {
      const storeItem = item && this.mediaStore.getItem(item.id);
      if (!storeItem || seenIds.has(storeItem.id)) return;
      seenIds.add(storeItem.id);

      if (storeItem.downloaded) {
        downloadedIds.push(storeItem.id);
      } else if (storeItem.downloading) {
        activeIds.push(storeItem.id);
      } else {
        requestItems.push(storeItem);
      }
    });

    const queuedIds = requestItems.map(item => item.id);
    if (queuedIds.length > 0) {
      // 先锁定卡片，再等待后台响应，连续点击时也能立即看到每一项已入队。
      this.mediaStore.markDownloading(queuedIds, 'queued');
      queuedIds.forEach(id => this.renderer.markItemDownloading(id, 'queued'));
    }

    const immediateFeedback = [];
    if (queuedIds.length > 0) {
      immediateFeedback.push(`${queuedIds.length} 个任务已加入队列`);
    }
    if (activeIds.length > 0) {
      immediateFeedback.push(`${activeIds.length} 个任务正在下载中`);
    }
    if (downloadedIds.length > 0) {
      immediateFeedback.push(`${downloadedIds.length} 个文件已下载过`);
    }
    if (immediateFeedback.length > 0) {
      this.showInfoToast(immediateFeedback.join('，'));
    }
    if (requestItems.length === 0) return;

    try {
      // 附加哈希指纹（如果已计算）
      const itemsWithPhash = requestItems.map(item => {
        const storeItem = this.mediaStore.getItem(item.id);
        if (!storeItem || (!storeItem.phash && !storeItem.dhash)) return item;
        return { ...item, phash: storeItem.phash, dhash: storeItem.dhash };
      });

      const result = await chrome.runtime.sendMessage({
        action: 'download_media',
        items: itemsWithPhash,
        category: category
      });

      if (result) {
        const feedback = [];
        const started = result.started || [];
        const inProgress = result.inProgress || [];
        const retrying = result.retrying || [];
        const duplicates = result.duplicates || [];
        const completed = result.downloaded || [];
        const failed = result.failed || [];
        const acceptedIds = new Set([
          ...started,
          ...inProgress,
          ...retrying,
          ...duplicates,
          ...completed
        ].map(id => String(id)));

        // 只把后台明确判定失败或无效的项回滚，避免请求尚未返回时短暂丢失状态。
        const unresolvedIds = queuedIds.filter(id => !acceptedIds.has(String(id)));
        if (unresolvedIds.length > 0) {
          this.mediaStore.markNotDownloaded(unresolvedIds);
          unresolvedIds.forEach(id => this.renderer.markItemNotDownloaded(id));
        }

        if (started.length > 0) {
          this.mediaStore.markDownloading(started, 'downloading');
          started.forEach(id => this.renderer.markItemDownloading(id, 'downloading'));
        }
        if (inProgress.length > 0) {
          this.mediaStore.markDownloading(inProgress, 'downloading');
          inProgress.forEach(id => this.renderer.markItemDownloading(id, 'downloading'));
        }
        if (retrying.length > 0) {
          this.mediaStore.markDownloading(retrying, 'retrying');
          retrying.forEach(id => this.renderer.markItemDownloading(id, 'retrying'));
          feedback.push(`${retrying.length} 个任务将在网络恢复后自动重试`);
        }
        if (completed.length > 0) {
          this.mediaStore.markDownloaded(completed);
          completed.forEach(id => {
            this.renderer.markItemDownloaded(id);
          });
          this.mediaStore.clearSelection();
          this.renderer.updateAllItemSelections();
        }

        if (duplicates.length > 0) {
          this.showDuplicateToast(duplicates.length);
          duplicates.forEach(id => {
            this.mediaStore.markDownloaded([id]);
            this.renderer.markItemDownloaded(id);
          });
          this.mediaStore.clearSelection();
          this.renderer.updateAllItemSelections();
        }

        if (failed.length > 0) {
          this.mediaStore.markNotDownloaded(failed);
          failed.forEach(id => this.renderer.markItemNotDownloaded(id));
          feedback.push(`${failed.length} 个下载失败，详情见下载中心`);
        }
        if (result.invalid > 0) {
          feedback.push(`${result.invalid} 个媒体地址无效`);
        }
        if (feedback.length > 0) {
          this.showInfoToast(feedback.join('，'));
        }
      } else {
        this.mediaStore.markNotDownloaded(queuedIds);
        queuedIds.forEach(id => this.renderer.markItemNotDownloaded(id));
        this.showInfoToast('下载请求没有得到响应，请重试');
      }
    } catch (e) {
      this.mediaStore.markNotDownloaded(queuedIds);
      queuedIds.forEach(id => this.renderer.markItemNotDownloaded(id));
      await this.restoreDownloadStates();
      this.showInfoToast('下载请求失败，请稍后重试');
    }
  }

  // ===== 暂存区（卡片下方的分区按钮） =====

  async loadStagedItems() {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'get_staged_media' });
      if (!result || !Array.isArray(result.items)) return;

      this.mediaStore.applyStaged(result.items);

      // 暂存项可能不在当前捕获列表里（跨会话或列表已清空），补回列表以便管理
      const missing = result.items.filter(item => !this.mediaStore.getItem(item.id));
      if (missing.length > 0) {
        this.mediaStore.addItems(missing.map(item => ({
          id: item.id,
          url: item.url,
          thumb: item.thumb,
          type: item.type,
          phash: item.phash || null,
          dhash: item.dhash || null,
          downloaded: false
        })), null);
        this.renderer.render();
        this.emptyState.style.display = 'none';
      }

      this.renderer.updateAllStagedStates();
      this.updateStagedStatus();
      this.updateCount();
    } catch (e) {}
  }

  async toggleStageItem(item, category) {
    const storeItem = this.mediaStore.getItem(item.id) || item;
    const staged = storeItem._stagedCategory;
    const normalizedCategory = category == null ? '' : category;
    const isSame = staged != null && String(staged) === String(normalizedCategory);

    try {
      if (isSame) {
        await chrome.runtime.sendMessage({ action: 'unstage_media', ids: [item.id] });
        this.mediaStore.setStaged(item.id, null);
      } else {
        const payload = (!storeItem.phash && !storeItem.dhash)
          ? item
          : { ...item, phash: storeItem.phash, dhash: storeItem.dhash };
        await chrome.runtime.sendMessage({
          action: 'stage_media',
          item: payload,
          category: normalizedCategory
        });
        this.mediaStore.setStaged(item.id, {
          id: item.id,
          url: item.url,
          thumb: item.thumb || null,
          type: item.type,
          phash: storeItem.phash || null,
          dhash: storeItem.dhash || null,
          category: normalizedCategory,
          stagedAt: Date.now()
        });
      }
      this.renderer.updateStagedState(
        this.renderer.grid.querySelector(`[data-id="${item.id}"]`),
        storeItem
      );
      this.updateStagedStatus();

      // 「已暂存」筛选或「隐藏已暂存」开启时，暂存状态变化需要立即增减列表项
      if (this.statusFilter === 'staged' || this.renderer.currentHideStaged) {
        this.renderer.render();
        this.updateSelectionUI();
      }
    } catch (e) {
      this.showInfoToast('暂存操作失败，请稍后重试');
    }
  }

  updateStagedStatus() {
    const count = this.mediaStore.stagedMap.size;
    if (this.statusStaged) {
      this.statusStaged.style.display = count > 0 ? 'inline-flex' : 'none';
      this.statusStaged.textContent = `暂存 ${count}`;
    }
    if (this.zipBadge) {
      this.zipBadge.hidden = count === 0;
      this.zipBadge.textContent = count > 99 ? '99+' : String(count);
    }
    if (this.zipBtn) {
      this.zipBtn.disabled = count === 0;
    }
  }

  updateUnstageBtnVisibility() {
    if (!this.unstageBtn) return;
    this.unstageBtn.hidden = this.statusFilter !== 'staged';
  }

  async unstageSelected() {
    const items = this.mediaStore.getSelectedItems();
    if (items.length === 0) {
      this.showInfoToast('请先选择要取消暂存的媒体');
      return;
    }
    try {
      await chrome.runtime.sendMessage({
        action: 'unstage_media',
        ids: items.map(item => item.id)
      });
      items.forEach(item => this.mediaStore.setStaged(item.id, null));
      this.mediaStore.clearSelection();
      this.renderer.render();
      this.updateSelectionUI();
      this.updateCount();
      this.updateStagedStatus();
      this.showInfoToast(`已取消 ${items.length} 项的暂存`);
    } catch (e) {
      this.showInfoToast('取消暂存失败，请稍后重试');
    }
  }

  /**
   * 把暂存区里的媒体交给下载中心打包
   */
  async packStagedItems() {
    let stagedItems = [];
    try {
      const res = await chrome.runtime.sendMessage({ action: 'get_staged_media' });
      if (res && Array.isArray(res.items)) {
        stagedItems = res.items;
        this.mediaStore.applyStaged(stagedItems);
      }
    } catch (e) {}

    if (stagedItems.length === 0) {
      this.showInfoToast('暂存区是空的：先点卡片下方的分区按钮');
      return;
    }

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'zip_prepare',
        items: stagedItems
      });
      if (!result || !result.ok) {
        this.showInfoToast('打包任务创建失败');
        return;
      }
      if (result.count === 0) {
        this.showInfoToast(`没有需要打包的新文件${result.duplicates ? `（${result.duplicates} 个已下载过）` : ''}`);
        return;
      }
      this.showInfoToast(`已创建打包任务：${result.count} 个文件${result.duplicates ? `，跳过 ${result.duplicates} 个已下载` : ''}，请在下载中心开始打包`);
    } catch (e) {
      this.showInfoToast('打包请求失败，请稍后重试');
    }
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
    chrome.runtime.sendMessage({ action: 'remove_captured_media', ids }).catch(() => {});
    chrome.runtime.sendMessage({ action: 'unstage_media', ids }).catch(() => {});
    this.updateCount();
    this.updateSelectionUI();
    this.updateStagedStatus();
    if (this.mediaStore.getAllItems().length === 0) {
      this.emptyState.style.display = 'block';
    }
    this.showInfoToast(`已删除 ${ids.length} 项`);
  }

  updateCount() {
    const counts = this.mediaStore.getCounts();
    this.countEl.innerHTML = `<span style="font-size: 14px; margin-left: 4px;">(${counts.total})</span> <span style="font-size: 12px; font-weight: normal; color: #71767b; margin-left: 4px;">图片 ${counts.photos} 视频 ${counts.videos} 已下 ${counts.downloaded} 未下 ${counts.notDownloaded}</span>`;
    if (this.statusDownloads) {
      this.statusDownloads.textContent = counts.downloading > 0
        ? `下载中 ${counts.downloading}`
        : '无下载任务';
      this.statusDownloads.classList.toggle('active', counts.downloading > 0);
    }
  }

  updateSelectionUI() {
    // 基于当前可见项判断是否全选，与 selectAll 的判断逻辑保持一致
    const visibleIds = Array.from(document.querySelectorAll('.x-media-item'))
      .map(el => el.dataset.id);
    const allSelected = visibleIds.length > 0 &&
      visibleIds.every(id => this.mediaStore.selectedIds.has(id));
    this.selectAllBtn.textContent = allSelected ? '取消全选' : '全选';
    this.downloadSelectedBtn.disabled = this.mediaStore.selectedIds.size === 0;
    this.updateSelectionBar();
  }

  /**
   * 导出媒体列表为 JSON 文件
   */
  exportMediaList() {
    const data = this.mediaStore.exportData();
    if (data.count === 0) {
      this.showInfoToast('没有可导出的媒体');
      return;
    }

    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `x-media-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showInfoToast(`已导出 ${data.count} 个媒体`);
  }

  /**
   * 处理导入文件选择
   */
  async handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const result = this.mediaStore.importData(data);
      if (result.success) {
        this.renderer.render();
        this.emptyState.style.display = this.mediaStore.getAllItems().length > 0 ? 'none' : 'block';
        this.updateCount();

        // 同步下载状态
        await this.checkHistoryForNewItems();

        this.showInfoToast(`导入完成：新增 ${result.added} 个，跳过 ${result.skipped} 个`);
      } else {
        this.showInfoToast(`导入失败：${result.error}`);
      }
    } catch (e) {
      this.showInfoToast('导入失败：文件格式错误');
    }

    // 清空 input 以便可以重复选择同一文件
    event.target.value = '';
  }
}

new SidePanelApp();
