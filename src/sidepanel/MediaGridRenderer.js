import { ICON_SELECT, ICON_CHECK } from './constants';

const ICON_DELETE = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

const ICON_DOWNLOAD_SINGLE = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;

class MediaGridRenderer {
  constructor(mediaStore) {
    this.mediaStore = mediaStore;
    this.grid = document.getElementById('x-media-grid');
    this.currentFilter = 'all';
    this.onDownload = null;
    this.onShowLightbox = null;
    this.onOpenUrl = null;
    this.onDeleteItem = null;
    this.clickToOpen = false;
    this.usePresets = true;
    this.categories = [
      { value: 'real', label: '真人' },
      { value: 'anime', label: '动漫' }
    ];
  }

  setClickToOpen(enabled) {
    this.clickToOpen = !!enabled;
  }

  setCategories(usePresets, categories) {
    this.usePresets = !!usePresets;
    this.categories = categories || [];
    this.render();
  }

  render() {
    this.grid.innerHTML = '';
    const items = this.mediaStore.getFilteredItems(this.currentFilter);

    items.reverse().forEach(item => {
      this.addMediaItem(item, false);
    });
  }

  addMediaItem(item, prepend = true) {
    const div = document.createElement('div');
    div.className = 'x-media-item';
    if (this.mediaStore.selectedIds.has(item.id)) {
      div.classList.add('selected');
    }
    if (item.downloaded) {
      div.classList.add('downloaded');
    }
    div.dataset.id = item.id;

    const isSelected = this.mediaStore.selectedIds.has(item.id);
    const selectTitle = isSelected ? '取消选择' : '选择';

    // 生成下载按钮
    let downloadButtonsHtml = '';
    if (this.usePresets && this.categories.length > 0) {
      downloadButtonsHtml = `<div class="x-dl-actions">
        ${this.categories.map((cat, i) => `<button class="x-dl-action-btn x-dl-cat-${i}" data-category="${cat.value}" title="下载到${cat.label}">${cat.label}</button>`).join('')}
      </div>`;
    } else {
      downloadButtonsHtml = `<div class="x-dl-actions">
        <button class="x-dl-action-btn x-dl-cat-0" data-category="" title="下载">下载</button>
      </div>`;
    }

    div.innerHTML = `
      <div class="x-media-thumb-container">
        <img src="${item.thumb}" loading="lazy">
      </div>
      <span class="x-media-type">${item.type}</span>
      ${item.downloaded ? '<span class="x-downloaded-badge">已下载</span>' : ''}
      <div class="x-item-btn x-item-select-btn ${isSelected ? 'selected' : ''}" title="${selectTitle}">${isSelected ? ICON_CHECK : ICON_SELECT}</div>
      <div class="x-item-btn x-item-delete-btn" title="删除">${ICON_DELETE}</div>
      ${item.downloaded ? `<div class="x-item-btn x-item-download-btn downloaded" title="已下载">${ICON_CHECK}</div>` : downloadButtonsHtml}
    `;

    this.bindThumbClick(div, item);
    this.bindSelectClick(div, item);
    this.bindDeleteClick(div, item);
    if (!item.downloaded) {
      this.bindDownloadActions(div, item);
    }

    if (prepend) {
      this.grid.prepend(div);
    } else {
      this.grid.appendChild(div);
    }
  }

  bindThumbClick(div, item) {
    const thumbContainer = div.querySelector('.x-media-thumb-container');
    thumbContainer.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.clickToOpen && this.onOpenUrl) {
        this.onOpenUrl(item);
      } else if (this.onShowLightbox) {
        this.onShowLightbox(item);
      }
    });
  }

  bindSelectClick(div, item) {
    const selectBtn = div.querySelector('.x-item-select-btn');
    selectBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      if (e.shiftKey && this.mediaStore.lastSelectedId) {
        const visibleItems = Array.from(document.querySelectorAll('.x-media-item'));
        const visibleIds = visibleItems.map(el => el.dataset.id);
        this.mediaStore.selectRange(this.mediaStore.lastSelectedId, item.id, visibleIds);
        this.updateAllItemSelections();
        return;
      }

      const newSelected = !this.mediaStore.selectedIds.has(item.id);
      this.mediaStore.selectItem(item.id, newSelected);
      this.updateItemSelection(div, item.id, newSelected);
    });
  }

  bindDeleteClick(div, item) {
    const deleteBtn = div.querySelector('.x-item-delete-btn');
    if (!deleteBtn) return;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onDeleteItem) {
        this.onDeleteItem([item.id]);
      }
    });
  }

  removeItem(id) {
    const div = this.grid.querySelector(`[data-id="${id}"]`);
    if (div) {
      div.remove();
    }
  }

  removeItems(ids) {
    ids.forEach(id => this.removeItem(id));
  }

  bindDownloadActions(div, item) {
    const actions = div.querySelector('.x-dl-actions');
    if (!actions) return;

    actions.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('.x-dl-action-btn');
      if (!btn) return;

      if (this.onDownload) {
        this.onDownload([item], btn.dataset.category);
      }
    });
  }

  updateItemSelection(div, id, selected) {
    div.classList.toggle('selected', selected);
    const btn = div.querySelector('.x-item-select-btn');
    if (btn) {
      btn.innerHTML = selected ? ICON_CHECK : ICON_SELECT;
      btn.title = selected ? '取消选择' : '选择';
      btn.classList.toggle('selected', selected);
    }
  }

  updateAllItemSelections() {
    document.querySelectorAll('.x-media-item').forEach(div => {
      const id = div.dataset.id;
      const selected = this.mediaStore.selectedIds.has(id);
      this.updateItemSelection(div, id, selected);
    });
  }

  markItemDownloaded(id) {
    const div = this.grid.querySelector(`[data-id="${id}"]`);
    if (!div) return;

    div.classList.add('downloaded');

    const existingBadge = div.querySelector('.x-downloaded-badge');
    if (!existingBadge) {
      const badge = document.createElement('span');
      badge.className = 'x-downloaded-badge';
      badge.textContent = '已下载';
      div.appendChild(badge);
    }

    const actions = div.querySelector('.x-dl-actions');
    if (actions) {
      actions.outerHTML = `<div class="x-item-btn x-item-download-btn downloaded" title="已下载">${ICON_CHECK}</div>`;
    }

    this.updateItemSelection(div, id, false);
  }

  setFilter(filter) {
    this.currentFilter = filter;
    this.render();
  }
}

export default MediaGridRenderer;
