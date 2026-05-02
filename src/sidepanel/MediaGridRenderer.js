import { ICON_SELECT, ICON_CHECK, ICON_DOWNLOAD, DOWNLOAD_CATEGORIES } from './constants';

class MediaGridRenderer {
  constructor(mediaStore) {
    this.mediaStore = mediaStore;
    this.grid = document.getElementById('x-media-grid');
    this.currentFilter = 'all';
    this.onDownload = null;
    this.onShowLightbox = null;

    this.bindDocumentClick();
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
      <div class="x-item-btn x-item-download-btn ${item.downloaded ? 'downloaded' : ''}" title="${item.downloaded ? '已下载' : '选择分类下载'}">${item.downloaded ? ICON_CHECK : ICON_DOWNLOAD}</div>
      <div class="x-download-menu" role="menu">
        ${DOWNLOAD_CATEGORIES.map(category => `<button type="button" data-category="${category.value}">${category.label}</button>`).join('')}
      </div>
    `;

    this.bindThumbClick(div, item);
    this.bindSelectClick(div, item);
    this.bindDownloadClick(div, item);

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

  bindDownloadClick(div, item) {
    const dlBtn = div.querySelector('.x-item-download-btn');
    const downloadMenu = div.querySelector('.x-download-menu');

    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dlBtn.classList.contains('downloaded')) return;
      this.closeDownloadMenus(downloadMenu);
      downloadMenu.classList.toggle('open');
    });

    downloadMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const option = e.target.closest('button[data-category]');
      if (!option || dlBtn.classList.contains('downloaded')) return;

      if (this.onDownload) {
        this.onDownload([item], option.dataset.category);
      }
      downloadMenu.classList.remove('open');
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

  markDownloadButtonDownloaded(dlBtn) {
    dlBtn.classList.add('downloaded');
    dlBtn.innerHTML = ICON_CHECK;
    dlBtn.title = '已下载';

    const mediaItem = dlBtn.closest('.x-media-item');
    if (mediaItem) {
      mediaItem.classList.add('downloaded');
      const existingBadge = mediaItem.querySelector('.x-downloaded-badge');
      if (!existingBadge) {
        const badge = document.createElement('span');
        badge.className = 'x-downloaded-badge';
        badge.textContent = '已下载';
        mediaItem.appendChild(badge);
      }
    }
  }

  closeDownloadMenus(exceptMenu = null) {
    document.querySelectorAll('.x-download-menu.open').forEach(menu => {
      if (menu !== exceptMenu) {
        menu.classList.remove('open');
      }
    });
  }

  bindDocumentClick() {
    document.addEventListener('click', () => {
      this.closeDownloadMenus();
    });
  }

  setFilter(filter) {
    this.currentFilter = filter;
    this.render();
  }
}

export default MediaGridRenderer;
