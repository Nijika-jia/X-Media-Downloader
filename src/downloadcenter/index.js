/**
 * 下载中心页面逻辑
 * 展示下载任务队列状态 + onDeterminingFilename 监听器诊断
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

const STATUS_LABELS = {
  pending: '等待中',
  downloading: '下载中',
  completed: '已完成',
  failed: '失败'
};

class DownloadCenterApp {
  constructor() {
    this.tasks = [];
    this.diagnostics = [];
    this.currentFilter = 'all';

    this.cacheElements();
    this.bindEvents();
    this.loadTasks();
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
      await chrome.runtime.sendMessage({ action: 'dc_retry', taskId });
    } catch (e) {}
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
}

document.addEventListener('DOMContentLoaded', () => {
  new DownloadCenterApp();
});
