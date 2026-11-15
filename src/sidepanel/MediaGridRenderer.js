import { ICON_SELECT, ICON_CHECK } from './constants';

const ICON_DELETE = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

const ICON_DOWNLOAD_SINGLE = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
const ICON_PLAY = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>`;
const DOWNLOAD_STATE_LABELS = {
  queued: '排队中',
  downloading: '下载中',
  retrying: '重试中'
};

/**
 * 转义字符串以安全插入 HTML 属性 / 文本，防止 URL 或其他动态值注入 HTML
 */
function escapeAttr(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

class MediaGridRenderer {
  constructor(mediaStore) {
    this.mediaStore = mediaStore;
    this.grid = document.getElementById('x-media-grid');
    this.currentTypeFilter = 'all';
    this.currentStatusFilter = 'all';
    this.currentHideStaged = false;
    this.onDownload = null;
    this.onShowLightbox = null;
    this.onOpenUrl = null;
    this.onDeleteItem = null;
    this.clickToOpen = false;
    this.hoverAutoplay = true;
    this.usePresets = true;
    this.categories = [
      { value: 'real', label: '真人' },
      { value: 'anime', label: '动漫' }
    ];
  }

  setClickToOpen(enabled) {
    this.clickToOpen = !!enabled;
  }

  setHoverAutoplay(enabled) {
    this.hoverAutoplay = !!enabled;
    if (!this.hoverAutoplay) {
      this.grid.querySelectorAll('video.x-hover-video').forEach(video => {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      });
    }
  }

  setCategories(usePresets, categories) {
    this.usePresets = !!usePresets;
    this.categories = categories || [];
    this.render();
  }

  render() {
    // 重建列表前停止所有视频（内联播放器/悬停预览），避免已被移除的 video 继续发声
    this.grid.querySelectorAll('video').forEach(video => video.pause());
    // 只移除卡片，保留动态创建的整排暂存按钮等辅助元素
    this.grid.querySelectorAll('.x-media-item').forEach(el => el.remove());
    const items = this.mediaStore.getFilteredItems(
      this.currentTypeFilter,
      this.currentStatusFilter,
      this.currentHideStaged
    );

    items.reverse().forEach(item => {
      this.addMediaItem(item, false);
    });

    if (this.onRender) this.onRender();
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
    const downloadState = item.downloading
      ? (DOWNLOAD_STATE_LABELS[item.downloadState] ? item.downloadState : 'downloading')
      : null;
    if (downloadState) {
      div.classList.add('downloading');
      div.classList.add(downloadState);
    }
    div.dataset.id = item.id;

    const isSelected = this.mediaStore.selectedIds.has(item.id);
    const selectTitle = isSelected ? '取消选择' : '选择';
    const isVideo = item.type === 'video' || item.type === 'animated_gif';

    // 生成下载按钮
    let downloadButtonsHtml = '';
    const actionClass = downloadState
      ? `x-dl-actions downloading ${downloadState}`
      : 'x-dl-actions';
    if (this.usePresets && this.categories.length > 0) {
      downloadButtonsHtml = `<div class="${actionClass}">
        ${this.categories.map((cat, i) => {
          const staged = !item.zipping && item._stagedCategory != null && String(item._stagedCategory) === String(cat.value);
          return `<button class="x-dl-action-btn x-dl-cat-${i}${staged ? ' staged' : ''}${item.zipping ? ' zipping' : ''}" data-category="${escapeAttr(cat.value)}" title="${item.zipping ? '正在打包中' : (staged ? `已暂存到${escapeAttr(cat.label)}，再次点击取消` : `暂存到${escapeAttr(cat.label)}`)}">${escapeAttr(cat.label)}</button>`;
        }).join('')}
      </div>`;
    } else {
      const staged = !item.zipping && item._stagedCategory != null;
      downloadButtonsHtml = `<div class="${actionClass}">
        <button class="x-dl-action-btn x-dl-cat-0${staged ? ' staged' : ''}${item.zipping ? ' zipping' : ''}" data-category="" title="${item.zipping ? '正在打包中' : (staged ? '已暂存，再次点击取消' : '暂存')}">${item.zipping ? '打包中' : (staged ? '已暂存' : '暂存')}</button>
      </div>`;
    }

    div.innerHTML = `
      <div class="x-media-thumb-container">
        <img src="${escapeAttr(item.thumb)}" loading="lazy">
      </div>
      <span class="x-media-type">${escapeAttr(item.type)}</span>
      ${isVideo ? `<div class="x-inline-play" title="在列表中播放">${ICON_PLAY}</div>` : ''}
      ${item.downloaded ? '<span class="x-downloaded-badge">已下载</span>' : (downloadState ? `<span class="x-downloading-badge ${downloadState}">${DOWNLOAD_STATE_LABELS[downloadState]}</span>` : '')}
      ${item.zipping
        ? '<span class="x-zipping-badge">打包中</span>'
        : (item._stagedCategory != null ? `<span class="x-staged-badge">已暂存 · ${escapeAttr(this.getStagedLabel(item))}</span>` : '')}
      <div class="x-item-btn x-item-select-btn ${isSelected ? 'selected' : ''}" title="${selectTitle}">${isSelected ? ICON_CHECK : ICON_SELECT}</div>
      <div class="x-item-btn x-item-delete-btn" title="删除">${ICON_DELETE}</div>
      ${item.downloaded ? `<div class="x-item-btn x-item-download-btn downloaded" title="已下载">${ICON_CHECK}</div>` : downloadButtonsHtml}
    `;

    this.bindThumbClick(div, item);
    this.bindSelectClick(div, item);
    this.bindDeleteClick(div, item);
    if (isVideo) {
      this.bindInlinePlay(div, item);
      this.bindHoverAutoplay(div, item);
    }
    if (!item.downloaded && !item.downloading) {
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

  /**
   * 悬停自动预览：鼠标停留片刻后静音循环播放，移出即停
   */
  bindHoverAutoplay(div, item) {
    let timer = null;
    let videoEl = null;

    const stop = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
        videoEl.remove();
        videoEl = null;
      }
    };

    div.addEventListener('mouseenter', () => {
      if (!this.hoverAutoplay) return;
      if (document.body.classList.contains('x-box-selecting')) return;
      if (div.classList.contains('inline-playing')) return;
      if (timer || videoEl) return;

      // 稍作停留再加载，避免快速划过时发起大量请求
      timer = setTimeout(() => {
        timer = null;
        if (!this.hoverAutoplay) return;
        if (document.body.classList.contains('x-box-selecting')) return;
        if (div.classList.contains('inline-playing')) return;
        if (!div.isConnected) return;

        videoEl = document.createElement('video');
        videoEl.className = 'x-hover-video';
        videoEl.src = item.url;
        videoEl.muted = true;
        videoEl.loop = true;
        videoEl.playsInline = true;
        videoEl.preload = 'auto';
        videoEl.addEventListener('error', stop);
        div.appendChild(videoEl);

        const playPromise = videoEl.play();
        if (playPromise && playPromise.catch) playPromise.catch(() => {});
      }, 250);
    });

    div.addEventListener('mouseleave', stop);
  }

  /**
   * 绑定卡片内播放按钮：在捕获列表里直接播放视频，无需跳转
   */
  bindInlinePlay(div, item) {
    const playBtn = div.querySelector('.x-inline-play');
    if (!playBtn) return;

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // 同一时间只保留一个内联播放器，避免多个视频同时出声
      this.stopOtherInlineVideos(div);
      this.startInlineVideo(div, item);
    });
  }

  startInlineVideo(div, item) {
    if (div.classList.contains('inline-playing')) return;

    // 悬停预览让位给带控制条的播放器
    const hoverVideo = div.querySelector('video.x-hover-video');
    if (hoverVideo) {
      hoverVideo.pause();
      hoverVideo.removeAttribute('src');
      hoverVideo.load();
      hoverVideo.remove();
    }

    const video = document.createElement('video');
    video.className = 'x-inline-video';
    video.src = item.url;
    video.poster = item.thumb || '';
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'auto';
    if (item.type === 'animated_gif') video.loop = true;

    const closeBtn = document.createElement('div');
    closeBtn.className = 'x-inline-video-close';
    closeBtn.title = '收起视频';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.stopInlineVideo(div);
    });

    video.addEventListener('error', () => {
      this.stopInlineVideo(div);
      this.showInlineNotice(div, '视频加载失败');
    });

    div.appendChild(video);
    div.appendChild(closeBtn);
    div.classList.add('inline-playing');

    const playPromise = video.play();
    if (playPromise && playPromise.catch) playPromise.catch(() => {});
  }

  stopInlineVideo(div) {
    div.classList.remove('inline-playing');
    const video = div.querySelector('.x-inline-video');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    }
    const closeBtn = div.querySelector('.x-inline-video-close');
    if (closeBtn) closeBtn.remove();
  }

  stopOtherInlineVideos(exceptDiv) {
    this.grid.querySelectorAll('.x-media-item.inline-playing').forEach(el => {
      if (el !== exceptDiv) this.stopInlineVideo(el);
    });
  }

  showInlineNotice(div, text) {
    const notice = document.createElement('span');
    notice.className = 'x-inline-notice';
    notice.textContent = text;
    div.appendChild(notice);
    setTimeout(() => notice.remove(), 2000);
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

      if (this.onStage) {
        this.onStage(item, btn.dataset.category);
      }
    });
  }

  getStagedLabel(item) {
    if (item._stagedCategory == null) return '';
    const cat = this.categories.find(c => String(c.value) === String(item._stagedCategory));
    return cat ? cat.label : '暂存';
  }

  /**
   * 刷新单张卡片的暂存按钮状态与角标（含打包中锁定状态）
   */
  updateStagedState(div, item) {
    if (!div || !item) return;
    const zipping = !!item.zipping;

    div.querySelectorAll('.x-dl-action-btn').forEach(btn => {
      const staged = !zipping && item._stagedCategory != null &&
        String(item._stagedCategory) === String(btn.dataset.category);
      btn.classList.toggle('staged', staged);
      btn.classList.toggle('zipping', zipping);
      if (this.usePresets) {
        const label = btn.textContent;
        btn.title = zipping
          ? '正在打包中'
          : (staged ? `已暂存到${label}，再次点击取消` : `暂存到${label}`);
      } else {
        btn.textContent = zipping ? '打包中' : (staged ? '已暂存' : '暂存');
        btn.title = zipping ? '正在打包中' : (staged ? '已暂存，再次点击取消' : '暂存');
      }
    });

    const stagedBadge = div.querySelector('.x-staged-badge');
    let zipBadge = div.querySelector('.x-zipping-badge');

    if (zipping) {
      if (stagedBadge) stagedBadge.remove();
      if (!zipBadge) {
        zipBadge = document.createElement('span');
        zipBadge.className = 'x-zipping-badge';
        zipBadge.textContent = '打包中';
        div.appendChild(zipBadge);
      }
      return;
    }

    if (zipBadge) zipBadge.remove();

    let badge = stagedBadge;
    if (item._stagedCategory != null) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'x-staged-badge';
        div.appendChild(badge);
      }
      badge.textContent = `已暂存 · ${this.getStagedLabel(item)}`;
    } else if (badge) {
      badge.remove();
    }
  }

  updateAllStagedStates() {
    this.grid.querySelectorAll('.x-media-item').forEach(div => {
      const item = this.mediaStore.getItem(div.dataset.id);
      if (item) this.updateStagedState(div, item);
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

    div.classList.remove('downloading', 'queued', 'retrying');
    div.classList.add('downloaded');

    const downloadingBadge = div.querySelector('.x-downloading-badge');
    if (downloadingBadge) downloadingBadge.remove();

    // 打包完成/下载完成后，暂存/打包标识不再需要
    const stagedBadge = div.querySelector('.x-staged-badge');
    if (stagedBadge) stagedBadge.remove();
    const zippingBadge = div.querySelector('.x-zipping-badge');
    if (zippingBadge) zippingBadge.remove();

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

  markItemNotDownloaded(id) {
    const item = this.mediaStore.getItem(id);
    if (item) item.downloaded = false;

    const div = this.grid.querySelector(`[data-id="${id}"]`);
    if (!div) return;
    div.classList.remove('downloading', 'queued', 'retrying');
    const downloadingBadge = div.querySelector('.x-downloading-badge');
    if (downloadingBadge) downloadingBadge.remove();
    const actions = div.querySelector('.x-dl-actions');
    if (actions) actions.classList.remove('downloading', 'queued', 'retrying');
  }

  markItemDownloading(id, state = 'downloading') {
    const item = this.mediaStore.getItem(id);
    if (item && item.downloaded) return;
    const div = this.grid.querySelector(`[data-id="${id}"]`);
    if (!div) return;

    const nextState = DOWNLOAD_STATE_LABELS[state] ? state : 'downloading';
    div.classList.remove('downloading', 'queued', 'retrying');
    div.classList.add('downloading', nextState);
    const actions = div.querySelector('.x-dl-actions');
    if (actions) {
      actions.classList.remove('downloading', 'queued', 'retrying');
      actions.classList.add('downloading', nextState);
    }
    let badge = div.querySelector('.x-downloading-badge');
    if (!badge) {
      const newBadge = document.createElement('span');
      newBadge.className = 'x-downloading-badge';
      div.appendChild(newBadge);
      badge = div.querySelector('.x-downloading-badge');
    }
    badge.className = `x-downloading-badge ${nextState}`;
    badge.textContent = DOWNLOAD_STATE_LABELS[nextState];
  }

  setFilter(typeFilter, statusFilter) {
    this.currentTypeFilter = typeFilter;
    this.currentStatusFilter = statusFilter;
    this.render();
  }

  setHideStaged(enabled) {
    this.currentHideStaged = !!enabled;
    this.render();
  }
}

export default MediaGridRenderer;
