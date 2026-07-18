import browser from '@/modules/Extension/browser';
import AbstractService from './AbstractService';

// storage.session 持久化 key（service worker 重启后不丢，但不跨浏览器重启）
const PENDING_KEY = 'x_pending_filenames';    // { url: filename } 映射
const TASKS_KEY = 'x_download_tasks';          // 任务队列数组
const DIAG_KEY = 'x_download_diagnostics';     // 诊断日志数组
const MAX_DIAG = 50;
const MAX_TASKS = 500;

class DownloadService extends AbstractService {
  static instance;

  // 内存态映射，供 onDeterminingFilename 监听器同步查询（监听器不能 await）
  _pendingFilenames = new Map();
  _filenameListenerBound = false;
  _onChangedListenerBound = false;
  // 内存态任务队列与诊断日志
  _tasks = [];
  _diagnostics = [];
  // 恢复持久化状态的 Promise；downloadMedia 开头 await 它，确保 Map 恢复后才触发下载
  _ready = null;
  // 串行化 storage 写入，避免并发 get-then-set 互相覆盖
  _writeChain = Promise.resolve();

  static getService() {
    if (!DownloadService.instance) {
      DownloadService.instance = new DownloadService();
    }
    return DownloadService.instance;
  }

  setApplication(application) {
    super.setApplication(application);
    this._ensureFilenameListener();
    this._ensureOnChangedListener();
    // service worker 重启后内存丢失，从 storage.session 恢复映射/任务/诊断
    this._ready = this._restoreFromStorage();
  }

  // ===== 监听器注册 =====

  _ensureFilenameListener() {
    if (this._filenameListenerBound) return;
    this._filenameListenerBound = true;
    // 背景：当任何扩展注册了 onDeterminingFilename 监听器时，chrome.downloads.download()
    // 的 filename 参数会被 Chrome 整个忽略。本扩展也注册监听器，在 suggest() 里夺回命名权。
    // 监听器同步调用 suggest，不能 await；映射必须已在内存中恢复好。
    browser.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
      const target = this._pendingFilenames.get(downloadItem.url);
      const hit = !!target;
      // 记录诊断（fire-and-forget，不阻塞 suggest）
      this._recordDiagnostic({
        url: downloadItem.url,
        expectedFilename: target || null,
        hit,
        downloadId: downloadItem.id,
        timestamp: Date.now()
      });
      if (target) {
        suggest({ filename: target, conflictAction: 'uniquify' });
        // 不在此 delete：等 onChanged state=complete 确认下载真正落地后再清理，
        // 避免 suggest 后下载仍失败时映射丢失无法重试
        this._markListenerHit(downloadItem.url);
      } else {
        // 非本扩展发起、或映射已失效（罕见），放行默认行为
        suggest();
      }
    });
  }

  _ensureOnChangedListener() {
    if (this._onChangedListenerBound) return;
    this._onChangedListenerBound = true;
    // 监听下载状态变化：complete → 任务完成 + 清理映射；interrupted → 任务失败
    browser.downloads.onChanged.addListener((delta) => {
      this._handleDownloadChanged(delta);
    });
  }

  // ===== 持久化恢复 =====

  async _restoreFromStorage() {
    try {
      const data = await new Promise(resolve => {
        browser.storage.session.get([PENDING_KEY, TASKS_KEY, DIAG_KEY], resolve);
      });
      const pending = data[PENDING_KEY];
      if (pending && typeof pending === 'object') {
        for (const [url, filename] of Object.entries(pending)) {
          this._pendingFilenames.set(url, filename);
        }
      }
      this._tasks = Array.isArray(data[TASKS_KEY]) ? data[TASKS_KEY] : [];
      this._diagnostics = Array.isArray(data[DIAG_KEY]) ? data[DIAG_KEY] : [];
    } catch (e) {
      console.error('[DownloadService] restore from storage failed:', e);
    }
  }

  // ===== 串行化 storage 写入 =====

  _serializeWrite(writer) {
    this._writeChain = this._writeChain
      .then(() => writer())
      .catch(err => console.error('[DownloadService] storage write failed:', err));
    return this._writeChain;
  }

  _persistPending() {
    return this._serializeWrite(() => new Promise(resolve => {
      const obj = Object.fromEntries(this._pendingFilenames);
      browser.storage.session.set({ [PENDING_KEY]: obj }, () => resolve());
    }));
  }

  _persistTasks() {
    return this._serializeWrite(() => new Promise(resolve => {
      if (this._tasks.length > MAX_TASKS) {
        this._tasks = this._tasks.slice(-MAX_TASKS);
      }
      browser.storage.session.set({ [TASKS_KEY]: this._tasks }, () => resolve());
    }));
  }

  _persistDiagnostics() {
    return this._serializeWrite(() => new Promise(resolve => {
      if (this._diagnostics.length > MAX_DIAG) {
        this._diagnostics = this._diagnostics.slice(-MAX_DIAG);
      }
      browser.storage.session.set({ [DIAG_KEY]: this._diagnostics }, () => resolve());
    }));
  }

  // ===== 诊断记录 =====

  _recordDiagnostic(diag) {
    this._diagnostics.push(diag);
    if (this._diagnostics.length > MAX_DIAG) {
      this._diagnostics = this._diagnostics.slice(-MAX_DIAG);
    }
    this._persistDiagnostics();
    this._broadcast({ action: 'dc_diag_update', diag });
  }

  // ===== 任务队列操作 =====

  _findTaskByUrl(url) {
    return this._tasks.find(t => t.url === url);
  }

  _findTaskByDownloadId(downloadId) {
    return this._tasks.find(t => t.downloadId === downloadId);
  }

  _updateTask(taskId, patch) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: Date.now() });
    this._persistTasks();
    this._broadcast({ action: 'dc_task_update', task });
    return task;
  }

  _markListenerHit(url) {
    const task = this._findTaskByUrl(url);
    if (task && task.listenerHit !== true) {
      task.listenerHit = true;
      task.updatedAt = Date.now();
      this._persistTasks();
      this._broadcast({ action: 'dc_task_update', task });
    }
  }

  _handleDownloadChanged(delta) {
    // delta: { id, state?: {current, previous}, error?: {current} }
    const task = this._findTaskByDownloadId(delta.id);
    if (!task) return;

    if (delta.state && delta.state.current === 'complete') {
      this._updateTask(task.id, { status: 'completed', error: null });
      // 下载真正完成，安全清理映射
      this._pendingFilenames.delete(task.url);
      this._persistPending();
    } else if (delta.state && delta.state.current === 'interrupted') {
      const errMsg = delta.error && delta.error.current
        ? String(delta.error.current)
        : 'interrupted';
      this._updateTask(task.id, { status: 'failed', error: errMsg });
    }
  }

  // ===== 广播给下载中心 tab（及其他扩展页面）=====

  _broadcast(message) {
    try {
      const p = browser.runtime.sendMessage(message);
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // 没有监听者时会 reject，忽略
        });
      }
    } catch (e) {
      // 忽略
    }
  }

  // ===== 下载文件夹计算 =====

  getDownloadFolder(category) {
    const categoryFolders = this.application.settings.categoryFolders || {};
    const baseFolder = this.application.settings.downloadFolder || 'X_Downloads';
    if (!category) return baseFolder;
    const subFolder = categoryFolders[category];
    return subFolder ? `${baseFolder}/${subFolder}` : baseFolder;
  }

  // ===== 核心下载方法 =====

  async downloadMedia({ items, category }) {
    // 等待持久化状态恢复完成，避免在 Map 还没恢复时触发下载导致监听器未命中
    if (this._ready) {
      await this._ready;
    }

    const historyService = this.application.getService('history');
    const { duplicates, newItems } = await historyService.batchCheckItems(items);

    const downloaded = [];
    const failed = [];

    if (newItems.length > 0) {
      const folder = this.getDownloadFolder(category || '');

      // 为每个 newItem 创建 pending 任务并设置映射
      const tasksToCreate = newItems.map(item => {
        let ext = 'jpg';
        if (item.type === 'video' || item.type === 'animated_gif') {
          ext = 'mp4';
        }
        const filename = `${folder}/x_${item.id}.${ext}`;
        return {
          id: item.id,
          url: item.url,
          thumb: item.thumb || null,
          type: item.type,
          category: category || '',
          expectedFilename: filename,
          status: 'pending',
          downloadId: null,
          listenerHit: null,
          error: null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      });

      tasksToCreate.forEach(t => {
        this._tasks.push(t);
        this._pendingFilenames.set(t.url, t.expectedFilename);
      });
      this._persistTasks();
      this._persistPending();
      tasksToCreate.forEach(t => this._broadcast({ action: 'dc_task_update', task: t }));

      // 并发触发下载。download() Promise resolve 仅表示下载已开始（拿到 downloadId），
      // 不代表完成——完成靠 onChanged state=complete 推进。
      const results = await Promise.allSettled(newItems.map((item, idx) => {
        const task = tasksToCreate[idx];
        return browser.downloads.download({
          url: item.url,
          filename: task.expectedFilename,
          conflictAction: 'uniquify'
        }).then(downloadId => {
          this._updateTask(task.id, { status: 'downloading', downloadId });
          return downloadId;
        }).catch(err => {
          this._updateTask(task.id, {
            status: 'failed',
            error: String((err && err.message) || err)
          });
          throw err;
        });
      }));

      // 注意：不再在此处 delete 映射。原代码在 Promise.allSettled 后立即 delete，
      // 若 onDeterminingFilename 在 download() resolve 之后才触发，映射已丢，监听器未命中。
      // 现在映射由 onChanged state=complete 时清理，更安全。

      const succeededItems = [];
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          succeededItems.push(newItems[idx]);
          downloaded.push(newItems[idx].id);
        } else {
          console.warn('[DownloadService] download failed:', newItems[idx].id, result.reason);
          failed.push(newItems[idx].id);
        }
      });

      if (succeededItems.length > 0) {
        await historyService.addItems(succeededItems);
      }
    }

    return {
      downloaded,
      duplicates: duplicates.map(i => i.id),
      failed,
      // debug 字段简化：详细诊断进下载中心看
      debug: newItems.length > 0 ? {
        count: newItems.length,
        folder: this.getDownloadFolder(category || '')
      } : null
    };
  }

  // ===== 公共方法（供 onMessage 路由调用）=====

  async listTasks() {
    if (this._ready) await this._ready;
    return {
      tasks: this._tasks,
      diagnostics: this._diagnostics
    };
  }

  async retryTask(taskId) {
    if (this._ready) await this._ready;
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return { ok: false, error: 'task_not_found' };
    if (task.status !== 'failed') return { ok: false, error: 'task_not_failed' };

    this._updateTask(taskId, {
      status: 'pending',
      downloadId: null,
      listenerHit: null,
      error: null
    });
    this._pendingFilenames.set(task.url, task.expectedFilename);
    this._persistPending();

    try {
      const downloadId = await browser.downloads.download({
        url: task.url,
        filename: task.expectedFilename,
        conflictAction: 'uniquify'
      });
      this._updateTask(taskId, { status: 'downloading', downloadId });
      return { ok: true };
    } catch (err) {
      this._updateTask(taskId, {
        status: 'failed',
        error: String((err && err.message) || err)
      });
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async clearTasks(filter) {
    if (filter && filter !== 'all') {
      this._tasks = this._tasks.filter(t => t.status !== filter);
    } else {
      this._tasks = [];
    }
    this._persistTasks();
    return { ok: true };
  }

  async openCenterTab() {
    const url = browser.runtime.getURL('downloadcenter.html');
    // 尝试复用已打开的下载中心 tab。chrome.tabs.query 查扩展自己的页面 URL
    // 不需要 tabs 权限；若失败则 fallback 到 create。
    try {
      const tabs = await browser.tabs.query({ url });
      if (tabs && tabs.length > 0) {
        await browser.tabs.update(tabs[0].id, { active: true });
        if (tabs[0].windowId !== undefined) {
          await browser.windows.update(tabs[0].windowId, { focused: true });
        }
        return { ok: true, tabId: tabs[0].id, reused: true };
      }
    } catch (e) {
      // query 失败（权限或其它），fallback 到 create
    }
    try {
      const tab = await browser.tabs.create({ url, active: true });
      return { ok: true, tabId: tab.id, reused: false };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }
}

export default DownloadService;
