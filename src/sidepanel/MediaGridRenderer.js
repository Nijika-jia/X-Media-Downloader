import { ICON_SELECT, ICON_CHECK, DOWNLOAD_CATEGORIES } from './constants';

class MediaGridRenderer {
  constructor(mediaStore) {
    this.mediaStore = mediaStore;
    this.grid = document.getElementById('x-media-grid');
    this.currentFilter = 'all';
    this.onDownload = null;
    this.onShowLightbox = null;
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

    div.innerHTML = `
      <div class="x-media-thumb-container">
        <img src="${item.thumb}" loading="lazy">
      </div>
      <span class="x-media-type">${item.type}</span>
      ${item.downloaded ? '<span class="x-downloaded-badge">已下载</span>' : ''}
      <div class="x-item-btn x-item-select-btn ${isSelected ? 'selected' : ''}" title="${selectTitle}">${isSelected ? ICON_CHECK : ICON_SELECT}</div>
      ${item.downloaded ? `<div class="x-item-btn x-item-download-btn downloaded" title="已下载">${ICON_CHECK}</div>` : `
      <div class="x-dl-actions">
        ${DOWNLOAD_CATEGORIES.map((cat, i) => `<button class="x-dl-action-btn x-dl-cat-${i}" data-category="${cat.value}" title="下载到${cat.label}">${cat.label}</button>`).join('')}
      </div>`}
    `;

    this.bindThumbClick(div, item);
    this.bindSelectClick(div, item);
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
      if (this.onShowLightbox) {
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
