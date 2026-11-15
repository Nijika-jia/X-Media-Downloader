/**
 * 下载中心页面逻辑
 * 展示下载任务队列状态 + onDeterminingFilename 监听器诊断 + 批量打包（zip）
 */

import { downloadZip } from 'client-zip';

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

function formatBytes(n) {
  const value = Number(n) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function zipExt(item) {
  return (item.type === 'video' || item.type === 'animated_gif') ? 'mp4' : 'jpg';
}

const STATUS_LABELS = {
  pending: '等待中',
  downloading: '下载中',
  retrying: '重试中',
  completed: '已完成',
  failed: '失败'
};

class DownloadCenterApp {
  constructor() {
    this.tasks = [];
    this.diagnostics = [];
    this.currentFilter = 'all';

    // 批量打包状态
    this.zipBatch = null;
    this.zipState = 'idle'; // idle | ready | packing | done | error
    this.zipMessage = '';
    this.zipAbort = null;
    this.zipStats = null;
    this._zipRaf = null;
    this._autoStartedBatchIds = new Set();

    this.cacheElements();
    this.bindEvents();
    this.loadTasks();
    this.loadZipBatch();
    this.listenForUpdates();
  }

  cacheElements() {
    this.taskList = document.getElementById('dc-task-list');
    this.countEl = document.getElementById('dc-count');
    this.emptyEl = document.getElementById('dc-empty');
    this.filterBtns = document.querySelectorAll('.dc-filter-btn');
    this.clearBtn = document.getElementById('dc-clear-btn');
    this.diagList = document.getElementById('dc-diag-list');
    this.diagToggle = document.getElementById('dc-diag-toggle');
    this.diagPanel = document.getElementById('dc-diag-panel');
    this.zipPanel = document.getElementById('dc-zip-panel');
    this.zipCount = document.getElementById('dc-zip-count');
    this.zipStatus = document.getElementById('dc-zip-status');
    this.zipBar = document.getElementById('dc-zip-bar-fill');
    this.zipStartBtn = document.getElementById('dc-zip-start');
    this.zipCancelBtn = document.getElementById('dc-zip-cancel');
  }

  bindEvents() {
    this.filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        this.renderTasks();
      });
    });

    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', () => this.clearCompleted());
    }

    if (this.diagToggle) {
      this.diagToggle.addEventListener('click', () => {
        this.diagPanel.classList.toggle('open');
      });
    }

    if (this.zipStartBtn) {
      this.zipStartBtn.addEventListener('click', () => this.startZip());
    }
    if (this.zipCancelBtn) {
      this.zipCancelBtn.addEventListener('click', () => this.cancelZip());
    }

    // 打包进行中关闭页面会中断流式下载，先提醒
    window.addEventListener('beforeunload', (e) => {
      if (this.zipState === 'packing') {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  async loadTasks() {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'dc_get_tasks' });
      if (result) {
        this.tasks = result.tasks || [];
        this.diagnostics = result.diagnostics || [];
      }
    } catch (e) {
      // 后端尚未注册 dc_get_tasks 时静默失败（骨架阶段）
    }
    this.renderTasks();
    this.renderDiagnostics();
    this.updateCount();
  }

  listenForUpdates() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'dc_task_update' && message.task) {
        const idx = this.tasks.findIndex(t => t.id === message.task.id);
        if (idx >= 0) {
          this.tasks[idx] = message.task;
        } else {
          this.tasks.unshift(message.task);
        }
        this.renderTasks();
        this.updateCount();
      }
      if (message.action === 'dc_diag_update' && message.diag) {
        this.diagnostics.unshift(message.diag);
        if (this.diagnostics.length > 50) this.diagnostics.pop();
        this.renderDiagnostics();
      }
      if (message.action === 'zip_batch_ready' && message.batch) {
        this.setZipBatch(message.batch);
      }
    });
  }

  getFilteredTasks() {
    if (this.currentFilter === 'all') return this.tasks;
    return this.tasks.filter(t => t.status === this.currentFilter);
  }

  renderTasks() {
    const tasks = this.getFilteredTasks();
    this.taskList.innerHTML = '';

    if (tasks.length === 0) {
      this.emptyEl.style.display = 'block';
      return;
    }
    this.emptyEl.style.display = 'none';

    tasks.forEach(task => {
      this.taskList.appendChild(this.renderTaskRow(task));
    });
  }

  renderTaskRow(task) {
    const row = document.createElement('div');
    row.className = `dc-task dc-task-${task.status}`;

    const statusLabel = STATUS_LABELS[task.status] || task.status;
    const typeBadge = task.type === 'video' || task.type === 'animated_gif' ? '视频' : '图片';
    const listenerHint = task.listenerHit === false && task.status !== 'pending'
      ? `<span class="dc-task-warn" title="onDeterminingFilename 监听器未命中，文件名可能未生效">监听器未命中</span>`
      : '';

    row.innerHTML = `
      <div class="dc-task-thumb">
        ${task.thumb ? `<img src="${escapeAttr(task.thumb)}" loading="lazy">` : '<div class="dc-task-thumb-placeholder"></div>'}
        <span class="dc-task-type">${typeBadge}</span>
      </div>
      <div class="dc-task-info">
        <div class="dc-task-filename" title="${escapeAttr(task.expectedFilename || task.url || '')}">${escapeAttr(task.expectedFilename || task.url || '')}</div>
        <div class="dc-task-meta">
          <span class="dc-task-status dc-status-${task.status}">${statusLabel}</span>
          ${task.status === 'retrying' ? `<span class="dc-task-retry-count">第 ${task.retryCount || 0}/${task.maxRetries || 3} 次</span>` : ''}
          ${task.category ? `<span class="dc-task-cat">${escapeAttr(task.category)}</span>` : ''}
          ${listenerHint}
          ${task.error ? `<span class="dc-task-error" title="${escapeAttr(task.error)}">${escapeAttr(task.error)}</span>` : ''}
        </div>
      </div>
      <div class="dc-task-actions">
        ${task.status === 'failed' ? `<button class="dc-retry-btn" data-id="${escapeAttr(String(task.id))}">重试</button>` : ''}
      </div>
    `;

    const retryBtn = row.querySelector('.dc-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.retryTask(task.id));
    }
    return row;
  }

  async retryTask(taskId) {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'dc_retry', taskId });
      if (!result || (!result.ok && !result.retrying)) {
        this.showNotice('重试没有启动，请查看任务状态后再试');
      } else if (result.retrying) {
        this.showNotice('网络仍不稳定，已进入自动重试');
      }
    } catch (e) {
      this.showNotice('重试请求失败，请稍后再试');
    }
  }

  showNotice(message) {
    const existing = document.querySelector('.dc-notice');
    if (existing) existing.remove();

    const notice = document.createElement('div');
    notice.className = 'dc-notice';
    notice.textContent = message;
    document.body.appendChild(notice);
    requestAnimationFrame(() => notice.classList.add('visible'));
    setTimeout(() => {
      notice.classList.remove('visible');
      setTimeout(() => notice.remove(), 180);
    }, 2600);
  }

  async clearCompleted() {
    try {
      await chrome.runtime.sendMessage({ action: 'dc_clear', filter: 'completed' });
      this.tasks = this.tasks.filter(t => t.status !== 'completed');
      this.renderTasks();
      this.updateCount();
    } catch (e) {}
  }

  renderDiagnostics() {
    if (!this.diagList) return;
    this.diagList.innerHTML = '';

    if (this.diagnostics.length === 0) {
      this.diagList.innerHTML = '<div class="dc-diag-empty">暂无诊断记录</div>';
      return;
    }

    this.diagnostics.slice(0, 20).forEach(diag => {
      const item = document.createElement('div');
      item.className = `dc-diag-item ${diag.hit ? 'dc-diag-hit' : 'dc-diag-miss'}`;
      const time = new Date(diag.timestamp).toLocaleTimeString();
      item.innerHTML = `
        <span class="dc-diag-time">${time}</span>
        <span class="dc-diag-badge">${diag.hit ? '命中' : '未命中'}</span>
        <span class="dc-diag-url" title="${escapeAttr(diag.url || '')}">${escapeAttr(diag.url || '')}</span>
        ${diag.expectedFilename ? `<span class="dc-diag-filename" title="${escapeAttr(diag.expectedFilename)}">${escapeAttr(diag.expectedFilename)}</span>` : ''}
      `;
      this.diagList.appendChild(item);
    });
  }

  updateCount() {
    this.countEl.textContent = this.tasks.length;
  }

  // ===== 批量打包（zip）=====

  async loadZipBatch() {
    try {
      const result = await chrome.storage.session.get('x_zip_batch');
      if (result && result.x_zip_batch) {
        this.setZipBatch(result.x_zip_batch);
      }
    } catch (e) {}
  }

  setZipBatch(batch) {
    if (!batch || !Array.isArray(batch.items) || batch.items.length === 0) return;
    // 同一批次重复广播时，不打断进行中/已完成的状态
    if (this.zipBatch && this.zipBatch.batchId === batch.batchId &&
        (this.zipState === 'packing' || this.zipState === 'done')) {
      return;
    }
    this.zipBatch = batch;
    this.zipState = 'ready';
    this.zipMessage = '';
    this.zipStats = {
      success: [],
      failed: [],
      currentIndex: 0,
      loaded: 0,
      totalBytes: 0,
      currentName: ''
    };
    this.renderZipPanel();

    // 一键打包：批次到达后自动开始；每个批次只触发一次，取消后可手动重试
    if (batch.autoStart && !this._autoStartedBatchIds.has(batch.batchId)) {
      this._autoStartedBatchIds.add(batch.batchId);
      this.startZip();
    }
  }

  renderZipPanel() {
    if (!this.zipPanel) return;
    if (!this.zipBatch) {
      this.zipPanel.hidden = true;
      return;
    }
    this.zipPanel.hidden = false;

    const total = this.zipBatch.items.length;
    const stats = this.zipStats || {
      success: [], failed: [], currentIndex: 0, loaded: 0, totalBytes: 0, currentName: ''
    };
    const duplicates = this.zipBatch.duplicates || 0;

    this.zipPanel.classList.toggle('is-packing', this.zipState === 'packing');
    this.zipPanel.classList.toggle('is-done', this.zipState === 'done');
    this.zipPanel.classList.toggle('is-error', this.zipState === 'error');
    this.zipCount.textContent = `${total} 个文件`;

    let statusText = '';
    let percent = 0;
    switch (this.zipState) {
      case 'ready':
        statusText = `等待开始${duplicates ? ` · 已跳过 ${duplicates} 个重复` : ''}`;
        break;
      case 'packing': {
        const idx = Math.min(stats.currentIndex + 1, total);
        const bytes = stats.totalBytes
          ? ` · ${formatBytes(stats.loaded)} / ${formatBytes(stats.totalBytes)}`
          : (stats.loaded ? ` · ${formatBytes(stats.loaded)}` : '');
        statusText = `正在打包 ${idx}/${total} · ${stats.currentName}${bytes}`;
        const fileProgress = stats.totalBytes ? Math.min(stats.loaded / stats.totalBytes, 1) : 0;
        percent = ((stats.currentIndex + fileProgress) / total) * 100;
        break;
      }
      case 'done':
        statusText = `完成：${this.zipMessage}（成功 ${stats.success.length}${stats.failed.length ? `，失败 ${stats.failed.length}` : ''}）`;
        percent = 100;
        break;
      case 'error':
        statusText = this.zipMessage || '打包失败';
        percent = 0;
        break;
      default:
        statusText = '等待开始';
    }

    this.zipStatus.textContent = statusText;
    this.zipBar.style.width = `${Math.max(0, Math.min(percent, 100))}%`;

    if (this.zipStartBtn) {
      const canStart = this.zipState === 'ready' || this.zipState === 'error';
      this.zipStartBtn.hidden = !canStart;
      this.zipStartBtn.textContent = this.zipState === 'error' ? '重试打包' : '开始打包';
    }
    if (this.zipCancelBtn) {
      this.zipCancelBtn.hidden = this.zipState !== 'packing';
    }
  }

  scheduleZipRender() {
    if (this._zipRaf) return;
    this._zipRaf = requestAnimationFrame(() => {
      this._zipRaf = null;
      this.renderZipPanel();
    });
  }

  async startZip() {
    if (!this.zipBatch || this.zipState === 'packing') return;
    const batch = this.zipBatch;

    this.zipState = 'packing';
    this.zipMessage = '';
    this.zipAbort = new AbortController();
    this.zipStats = {
      success: [],
      failed: [],
      currentIndex: 0,
      loaded: 0,
      totalBytes: 0,
      currentName: ''
    };
    this.renderZipPanel();

    try {
      const response = downloadZip(this.buildZipEntries(batch, this.zipAbort.signal));
      const blob = await response.blob();
      if (this.zipAbort.signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const filename = this.buildZipFilename();
      this.triggerZipDownload(blob, filename);
      this.zipMessage = filename;

      const successItems = this.zipStats.success.map(item => ({
        id: item.id,
        type: item.type,
        url: item.url,
        thumb: item.thumb || null,
        phash: item.phash || null,
        dhash: item.dhash || null
      }));

      this.zipState = 'done';
      this.renderZipPanel();

      await chrome.runtime.sendMessage({
        action: 'zip_batch_done',
        batchId: batch.batchId,
        items: successItems
      }).catch(() => {});
    } catch (e) {
      if (e && e.name === 'AbortError') {
        this.zipState = 'ready';
        this.zipMessage = '';
        this.renderZipPanel();
        this.showNotice('已取消打包');
      } else {
        this.zipState = 'error';
        this.zipMessage = `打包失败：${e && e.message ? e.message : '未知错误'}`;
        this.renderZipPanel();
      }
    } finally {
      this.zipAbort = null;
    }
  }

  async *buildZipEntries(batch, signal) {
    const stats = this.zipStats;

    for (let i = 0; i < batch.items.length; i++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const item = batch.items[i];
      const folder = item.folder || batch.categoryFolder || '';
      const prefix = folder ? `${folder}/` : '';
      stats.currentIndex = i;
      stats.loaded = 0;
      stats.totalBytes = 0;
      stats.currentName = `x_${item.id}.${zipExt(item)}`;
      this.scheduleZipRender();

      let res;
      try {
        res = await fetch(item.url, { signal });
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        stats.failed.push({ id: item.id, reason: '网络错误' });
        continue;
      }
      if (!res.ok) {
        stats.failed.push({ id: item.id, reason: `HTTP ${res.status}` });
        continue;
      }

      const fileSize = Number(res.headers.get('content-length')) || 0;
      let loaded = 0;
      let input = res;
      if (res.body) {
        const body = res.body.pipeThrough(new TransformStream({
          transform: (chunk, controller) => {
            loaded += chunk.byteLength;
            stats.loaded = loaded;
            stats.totalBytes = fileSize;
            this.scheduleZipRender();
            controller.enqueue(chunk);
          }
        }));
        input = new Response(body, { headers: res.headers });
      }

      stats.success.push(item);
      yield {
        name: `${prefix}x_${item.id}.${zipExt(item)}`,
        input,
        lastModified: new Date()
      };
    }
  }

  cancelZip() {
    if (this.zipAbort) this.zipAbort.abort();
    // 取消后清掉持久化批次，避免下次打开页面又自动开始；页面内仍可手动重试
    try {
      chrome.storage.session.remove('x_zip_batch', () => {});
    } catch (e) {}
  }

  triggerZipDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  buildZipFilename() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `X-Media-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new DownloadCenterApp();
});
