import browser from '@/modules/Extension/browser';
import AbstractService from './AbstractService';
import { normalizeMediaItems, sanitizePathPart } from '../mediaValidation';

// storage.session 持久化 key（service worker 重启后不丢，但不跨浏览器重启）
const PENDING_KEY = 'x_pending_filenames';    // { url: filename } 映射
const TASKS_KEY = 'x_download_tasks';          // 任务队列数组
const DIAG_KEY = 'x_download_diagnostics';     // 诊断日志数组
const MAX_DIAG = 50;
const MAX_TASKS = 500;
const MAX_AUTO_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 8000];
const RETRYABLE_ERRORS = [
  'NETWORK_INVALID',
  'NETWORK_TIMEOUT',
  'NETWORK_DISCONNECTED',
  'NETWORK_SERVER_DOWN',
  'NETWORK_FAILED',
  'SERVER_FAILED',
  'CRASH'
];

function canonicalizeDownloadUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch (e) {
    return value;
  }
}

function getDownloadUrlPath(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch (e) {
    return value.split(/[?#]/, 1)[0];
  }
}

function getDownloadUrlCandidates(downloadItem) {
  return [downloadItem && downloadItem.url, downloadItem && downloadItem.finalUrl]
    .filter(url => typeof url === 'string' && url.length > 0);
}

class DownloadService extends AbstractService {
  static instance;

  // 内存态映射，供 onDeterminingFilename 监听器同步查询（监听器不能 await）
  _pendingFilenames = new Map();
  // 某些 Chrome 版本在回调时返回的 URL 与请求 URL 不同，下载 ID 是更稳定的兜底键。
  _pendingFilenamesById = new Map();
  _filenameListenerBound = false;
  _onChangedListenerBound = false;
  _retryAlarmListenerBound = false;
  // 内存态任务队列与诊断日志
  _tasks = [];
  _diagnostics = [];
  // 恢复持久化状态的 Promise；downloadMedia 开头 await 它，确保 Map 恢复后才触发下载
  _ready = null;
  // 串行化 storage 写入，避免并发 get-then-set 互相覆盖
  _writeChain = Promise.resolve();
  _downloadChain = Promise.resolve();
  _retryTimers = new Map();

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
    this._ensureRetryAlarmListener();
    // service worker 重启后内存丢失，从 storage.session 恢复映射/任务/诊断
    this._ready = this._restoreFromStorage().then(async () => {
      this._restoreRetryTimers();
      await this._restoreIncompleteTasks();
    });
  }

  // ===== 监听器注册 =====

  _ensureFilenameListener() {
    if (this._filenameListenerBound) return;
    this._filenameListenerBound = true;
    // 背景：当任何扩展注册了 onDeterminingFilename 监听器时，chrome.downloads.download()
    // 的 filename 参数会被 Chrome 整个忽略。本扩展也注册监听器，在 suggest() 里夺回命名权。
    // 监听器同步调用 suggest，不能 await；映射必须已在内存中恢复好。
    browser.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
      const match = this._findPendingFilename(downloadItem);
      const target = match ? match.filename : null;
      const hit = !!target;
      // 记录诊断（fire-and-forget，不阻塞 suggest）
      this._recordDiagnostic({
        url: downloadItem.url,
        finalUrl: downloadItem.finalUrl || null,
        expectedFilename: target || null,
        hit,
        matchType: match ? match.matchType : 'miss',
        downloadId: downloadItem.id,
        timestamp: Date.now()
      });
      if (target) {
        suggest({ filename: target, conflictAction: 'uniquify' });
        // 不在此 delete：等 onChanged state=complete 确认下载真正落地后再清理，
        // 避免 suggest 后下载仍失败时映射丢失无法重试
        this._markListenerHit(downloadItem);
      } else {
        // 非本扩展发起、或映射已失效（罕见），放行默认行为
        suggest();
      }
    });
  }

  _ensureOnChangedListener() {
    if (this._onChangedListenerBound) return;
    this._onChangedListenerBound = true;
    // 监听下载状态变化：complete → 任务完成；interrupted → 自动重试或最终失败
    browser.downloads.onChanged.addListener((delta) => {
      this._handleDownloadChanged(delta).catch(error => {
        console.error('[DownloadService] download state handling failed:', error);
      });
    });
  }

  _ensureRetryAlarmListener() {
    if (this._retryAlarmListenerBound || !browser.alarms || !browser.alarms.onAlarm) return;
    this._retryAlarmListenerBound = true;
    browser.alarms.onAlarm.addListener(alarm => {
      const prefix = 'x_media_retry_';
      if (!alarm || typeof alarm.name !== 'string' || !alarm.name.startsWith(prefix)) return;
      const taskId = alarm.name.slice(prefix.length);
      this._clearRetryTimer(taskId);
      this._retryTaskAttempt(taskId).catch(error => {
        console.error('[DownloadService] alarm retry attempt failed:', error);
      });
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
      const restoredTasks = Array.isArray(data[TASKS_KEY])
        ? data[TASKS_KEY].map(task => ({
          ...task,
          retryCount: Number.isFinite(Number(task.retryCount)) ? Number(task.retryCount) : 0,
          maxRetries: Number.isFinite(Number(task.maxRetries)) ? Number(task.maxRetries) : MAX_AUTO_RETRIES,
          retryAt: task.retryAt || null
        }))
        : [];
      // 旧版本允许同一媒体产生多条任务；保留最新一条，避免后续状态广播更新错行。
      const taskById = new Map();
      restoredTasks.forEach(task => {
        const key = String(task.id);
        const previous = taskById.get(key);
        if (!previous || (task.updatedAt || 0) >= (previous.updatedAt || 0)) {
          taskById.set(key, task);
        }
      });
      this._tasks = Array.from(taskById.values());
      this._diagnostics = Array.isArray(data[DIAG_KEY]) ? data[DIAG_KEY] : [];
    } catch (e) {
      console.error('[DownloadService] restore from storage failed:', e);
    }
  }

  // ===== 串行化 storage 写入 =====

  _serializeWrite(writer) {
    const operation = this._writeChain.then(() => writer());
    this._writeChain = operation.catch(err => {
      console.error('[DownloadService] storage write failed:', err);
    });
    return operation;
  }

  _setSessionStorage(value) {
    return new Promise((resolve, reject) => {
      browser.storage.session.set(value, () => {
        const runtimeError = browser.runtime && browser.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || 'session storage write failed'));
          return;
        }
        resolve();
      });
    });
  }

  _persistPending() {
    return this._serializeWrite(() => {
      const obj = Object.fromEntries(this._pendingFilenames);
      return this._setSessionStorage({ [PENDING_KEY]: obj });
    });
  }

  _persistTasks() {
    return this._serializeWrite(() => {
      if (this._tasks.length > MAX_TASKS) {
        this._tasks = this._tasks.slice(-MAX_TASKS);
      }
      return this._setSessionStorage({ [TASKS_KEY]: this._tasks });
    });
  }

  _persistDiagnostics() {
    return this._serializeWrite(() => {
      if (this._diagnostics.length > MAX_DIAG) {
        this._diagnostics = this._diagnostics.slice(-MAX_DIAG);
      }
      return this._setSessionStorage({ [DIAG_KEY]: this._diagnostics });
    });
  }

  // ===== 诊断记录 =====

  _recordDiagnostic(diag) {
    this._diagnostics.push(diag);
    if (this._diagnostics.length > MAX_DIAG) {
      this._diagnostics = this._diagnostics.slice(-MAX_DIAG);
    }
    this._persistDiagnostics().catch(() => {});
    this._broadcast({ action: 'dc_diag_update', diag });
  }

  // ===== 任务队列操作 =====

  _findTaskByUrl(url) {
    for (let i = this._tasks.length - 1; i >= 0; i--) {
      if (this._tasks[i].url === url) return this._tasks[i];
    }
    return null;
  }

  _findTaskById(taskId) {
    const matches = this._tasks.filter(t => String(t.id) === String(taskId));
    return matches.find(task => ['pending', 'downloading', 'retrying'].includes(task.status)) ||
      matches[matches.length - 1] ||
      null;
  }

  _findTaskByDownloadId(downloadId) {
    return this._tasks.find(t => t.downloadId === downloadId);
  }

  _findPendingFilename(downloadItem) {
    if (downloadItem && this._pendingFilenamesById.has(downloadItem.id)) {
      return {
        filename: this._pendingFilenamesById.get(downloadItem.id),
        key: null,
        matchType: 'downloadId'
      };
    }

    const candidates = getDownloadUrlCandidates(downloadItem);
    for (const url of candidates) {
      if (this._pendingFilenames.has(url)) {
        return {
          filename: this._pendingFilenames.get(url),
          key: url,
          matchType: url === downloadItem.url ? 'url' : 'finalUrl'
        };
      }
    }

    const canonicalCandidates = new Set(candidates.map(canonicalizeDownloadUrl));
    for (const [url, filename] of this._pendingFilenames.entries()) {
      if (canonicalCandidates.has(canonicalizeDownloadUrl(url))) {
        return { filename, key: url, matchType: 'canonicalUrl' };
      }
    }

    const pathCandidates = new Set(candidates.map(getDownloadUrlPath));
    for (const [url, filename] of this._pendingFilenames.entries()) {
      if (pathCandidates.has(getDownloadUrlPath(url))) {
        return { filename, key: url, matchType: 'urlPath' };
      }
    }

    return null;
  }

  _updateTask(taskId, patch) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: Date.now() });
    this._persistTasks().catch(() => {});
    this._broadcast({ action: 'dc_task_update', task });
    return task;
  }

  _markListenerHit(downloadItem) {
    const candidates = getDownloadUrlCandidates(downloadItem);
    let task = this._findTaskByDownloadId(downloadItem && downloadItem.id) ||
      candidates.map(url => this._findTaskByUrl(url)).find(Boolean);

    if (!task) {
      const pathCandidates = new Set(candidates.map(getDownloadUrlPath));
      task = this._tasks.find(item => pathCandidates.has(getDownloadUrlPath(item.url)));
    }

    if (task && task.listenerHit !== true) {
      task.listenerHit = true;
      task.updatedAt = Date.now();
      this._persistTasks().catch(() => {});
      this._broadcast({ action: 'dc_task_update', task });
    }
  }

  _clearRetryTimer(taskId) {
    const timer = this._retryTimers.get(String(taskId));
    if (timer) clearTimeout(timer);
    this._retryTimers.delete(String(taskId));
    if (browser.alarms && browser.alarms.clear) {
      const clearResult = browser.alarms.clear(`x_media_retry_${taskId}`);
      if (clearResult && typeof clearResult.catch === 'function') {
        clearResult.catch(() => {});
      }
    }
  }

  _restoreRetryTimers() {
    this._tasks
      .filter(task => task.status === 'retrying')
      .forEach(task => {
        if (!this._pendingFilenames.has(task.url)) {
          this._pendingFilenames.set(task.url, task.expectedFilename);
        }
        this._scheduleRetryTimer(task);
      });
  }

  async _restoreIncompleteTasks() {
    const pendingTasks = this._tasks.filter(task =>
      task.status === 'pending' && (task.downloadId === null || task.downloadId === undefined)
    );
    const activeTasks = this._tasks.filter(task =>
      task.status === 'downloading' && task.downloadId !== null && task.downloadId !== undefined
    );

    await Promise.allSettled([
      ...pendingTasks.map(task => this._startTask(task)),
      ...activeTasks.map(task => this._syncDownloadState(task.downloadId))
    ]);
  }

  _scheduleRetryTimer(task) {
    if (!task || task.status !== 'retrying') return;

    this._clearRetryTimer(task.id);
    const retryAt = Number(task.retryAt) || Date.now();
    const delay = Math.max(0, retryAt - Date.now());
    const timer = setTimeout(() => {
      this._retryTimers.delete(String(task.id));
      this._retryTaskAttempt(task.id).catch(error => {
        console.error('[DownloadService] retry attempt failed:', error);
      });
    }, delay);
    this._retryTimers.set(String(task.id), timer);
    if (browser.alarms && browser.alarms.create) {
      const alarmResult = browser.alarms.create(`x_media_retry_${task.id}`, { when: retryAt });
      if (alarmResult && typeof alarmResult.catch === 'function') {
        alarmResult.catch(error => {
          console.error('[DownloadService] retry alarm scheduling failed:', error);
        });
      }
    }
  }

  _isRetryableError(error) {
    const message = String(error || '').toUpperCase();
    return RETRYABLE_ERRORS.some(code => message.includes(code)) ||
      /NETWORK|TIMEOUT|DISCONNECT|CONNECTION|OFFLINE|FETCH FAILED/.test(message);
  }

  _getErrorMessage(error) {
    return String((error && error.message) || error || '下载失败');
  }

  _removeDownloadIdMapping(task) {
    if (task && task.downloadId !== null && task.downloadId !== undefined) {
      this._pendingFilenamesById.delete(task.downloadId);
    }
  }

  async _markTaskFailed(task, error) {
    const current = this._findTaskById(task && task.id);
    if (!current) return { ok: false, error: 'task_removed' };

    this._clearRetryTimer(current.id);
    this._removeDownloadIdMapping(current);
    this._pendingFilenames.delete(current.url);
    this._updateTask(current.id, {
      status: 'failed',
      downloadId: null,
      retryAt: null,
      error: this._getErrorMessage(error)
    });
    await this._persistPending();
    return { ok: false, error: this._getErrorMessage(error) };
  }

  async _scheduleRetry(task, error) {
    const current = this._findTaskById(task && task.id);
    if (!current) return { ok: false, error: 'task_removed' };
    if (current.status === 'retrying') return { ok: false, retrying: true };
    if (current.status === 'completed' || current.status === 'failed') {
      return { ok: false, error: current.error || 'task_not_active' };
    }

    const retryCount = Number(current.retryCount) || 0;
    const maxRetries = Number(current.maxRetries) || MAX_AUTO_RETRIES;
    if (!this._isRetryableError(error) || retryCount >= maxRetries) {
      return this._markTaskFailed(current, error);
    }

    const nextRetryCount = retryCount + 1;
    const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
    const retryAt = Date.now() + delay;
    this._removeDownloadIdMapping(current);
    current.downloadId = null;
    this._pendingFilenames.set(current.url, current.expectedFilename);
    this._updateTask(current.id, {
      status: 'retrying',
      downloadId: null,
      listenerHit: null,
      retryCount: nextRetryCount,
      maxRetries,
      retryAt,
      error: `网络波动，${Math.ceil(delay / 1000)} 秒后自动重试（${nextRetryCount}/${maxRetries}）`
    });
    await this._persistPending();
    this._scheduleRetryTimer(current);
    return { ok: false, retrying: true };
  }

  async _startTask(task) {
    const current = this._findTaskById(task && task.id);
    if (!current) return { ok: false, error: 'task_removed' };

    this._clearRetryTimer(current.id);
    this._pendingFilenames.set(current.url, current.expectedFilename);
    await this._persistPending();

    try {
      const downloadId = await browser.downloads.download({
        url: current.url,
        filename: current.expectedFilename,
        conflictAction: 'uniquify'
      });
      const latest = this._findTaskById(current.id);
      if (!latest) return { ok: false, error: 'task_removed' };
      this._pendingFilenamesById.set(downloadId, latest.expectedFilename);
      this._updateTask(latest.id, {
        status: 'downloading',
        downloadId,
        retryAt: null,
        error: null
      });
      // 极短下载可能在 download() 返回前就完成/中断；补查当前状态，避免漏掉 onChanged 事件。
      await this._syncDownloadState(downloadId);
      const finalTask = this._findTaskById(latest.id);
      if (finalTask && finalTask.status === 'retrying') {
        return { ok: false, retrying: true };
      }
      if (finalTask && finalTask.status === 'failed') {
        return { ok: false, error: finalTask.error || '下载失败' };
      }
      if (finalTask && finalTask.status === 'completed') {
        return { ok: true, completed: true };
      }
      return { ok: true, downloadId };
    } catch (error) {
      return this._scheduleRetry(current, error);
    }
  }

  async _syncDownloadState(downloadId) {
    if (!browser.downloads.search) return;
    try {
      const items = await browser.downloads.search({ id: downloadId });
      const item = Array.isArray(items) ? items[0] : null;
      if (!item || !item.state || item.state === 'in_progress') return;
      const delta = {
        id: downloadId,
        state: { current: item.state }
      };
      if (item.error) delta.error = { current: item.error };
      await this._handleDownloadChanged(delta);
    } catch (error) {
      // 查询只是竞态兜底，失败时仍依赖正常的 onChanged 事件。
      console.warn('[DownloadService] download state sync failed:', error);
    }
  }

  async _retryTaskAttempt(taskId) {
    const task = this._findTaskById(taskId);
    if (!task || task.status !== 'retrying') return { ok: false, error: 'task_not_retrying' };

    this._updateTask(task.id, {
      status: 'pending',
      retryAt: null,
      listenerHit: null,
      error: null,
      downloadId: null
    });
    return this._startTask(task);
  }

  async _handleDownloadChanged(delta) {
    // delta: { id, state?: {current, previous}, error?: {current} }
    const task = this._findTaskByDownloadId(delta.id);
    if (!task) return;

    if (delta.state && delta.state.current === 'complete') {
      if (task.status === 'completed') return;
      this._clearRetryTimer(task.id);
      this._updateTask(task.id, { status: 'completed', error: null });
      // 下载真正完成，安全清理映射
      this._pendingFilenames.delete(task.url);
      if (task.downloadId !== null) {
        this._pendingFilenamesById.delete(task.downloadId);
      }
      await this._persistPending();

      if (this.application.settings.enableSaveDownloadHistory !== false) {
        const historyService = this.application.getService('history');
        await historyService.addItems([{
          id: task.id,
          type: task.type,
          url: task.url,
          thumb: task.thumb,
          phash: task.phash || null,
          dhash: task.dhash || null
        }]);
      }
    } else if (delta.state && delta.state.current === 'interrupted') {
      const errMsg = delta.error && delta.error.current
        ? String(delta.error.current)
        : 'interrupted';
      await this._scheduleRetry(task, errMsg);
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
    const baseFolder = sanitizePathPart(
      this.application.settings.downloadFolder,
      'X_Downloads'
    );
    if (!category) return baseFolder;
    const subFolder = sanitizePathPart(categoryFolders[category], '');
    return subFolder ? `${baseFolder}/${subFolder}` : baseFolder;
  }

  _findActiveTask(item) {
    return this._tasks.find(task =>
      (task.status === 'pending' || task.status === 'downloading' || task.status === 'retrying') &&
      (String(task.id) === String(item.id) || task.url === item.url)
    );
  }

  // ===== 核心下载方法 =====

  downloadMedia(params) {
    const operation = this._downloadChain.then(() => this._downloadMedia(params));
    this._downloadChain = operation.catch(() => {});
    return operation;
  }

  async _downloadMedia({ items, category }) {
    // 等待持久化状态恢复完成，避免在 Map 还没恢复时触发下载导致监听器未命中
    if (this._ready) {
      await this._ready;
    }

    const normalizedItems = normalizeMediaItems(items);
    const invalid = Array.isArray(items)
      ? Math.max(0, items.length - normalizedItems.length)
      : 0;
    const historyService = this.application.getService('history');
    const checked = await historyService.batchCheckItems(normalizedItems);
    const duplicates = checked.duplicates;
    const inProgress = [];
    const newItems = [];
    checked.newItems.forEach(item => {
      if (this._findActiveTask(item)) {
        inProgress.push(item);
      } else {
        newItems.push(item);
      }
    });

    const started = [];
    const completed = [];
    const failed = [];
    const retrying = [];

    if (newItems.length > 0) {
      const folder = this.getDownloadFolder(category || '');

      // 为每个 newItem 创建 pending 任务并设置映射
      const tasksToCreate = newItems.map(item => {
        let ext = 'jpg';
        if (item.type === 'video' || item.type === 'animated_gif') {
          ext = 'mp4';
        }
        const filename = `${folder}/x_${sanitizePathPart(item.id, 'media')}.${ext}`;
        const taskData = {
          id: item.id,
          url: item.url,
          thumb: item.thumb || null,
          type: item.type,
          phash: item.phash || null,
          dhash: item.dhash || null,
          category: category || '',
          expectedFilename: filename,
          status: 'pending',
          downloadId: null,
          listenerHit: null,
          retryCount: 0,
          maxRetries: MAX_AUTO_RETRIES,
          retryAt: null,
          error: null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        const existing = this._tasks
          .slice()
          .reverse()
          .find(task => String(task.id) === String(item.id) && task.status === 'failed');
        if (existing) {
          Object.assign(existing, taskData);
          return existing;
        }
        return taskData;
      });

      tasksToCreate.forEach(t => {
        if (!this._tasks.includes(t)) this._tasks.push(t);
        this._pendingFilenames.set(t.url, t.expectedFilename);
      });
      await this._persistTasks();
      await this._persistPending();
      tasksToCreate.forEach(t => this._broadcast({ action: 'dc_task_update', task: t }));

      // 并发触发下载。download() Promise resolve 仅表示下载已开始（拿到 downloadId），
      // 不代表完成——完成靠 onChanged state=complete 推进。
      const results = await Promise.all(newItems.map((item, idx) => {
        const task = tasksToCreate[idx];
        return this._startTask(task);
      }));

      // 注意：不再在此处 delete 映射。原代码在 Promise.allSettled 后立即 delete，
      // 若 onDeterminingFilename 在 download() resolve 之后才触发，映射已丢，监听器未命中。
      // 现在映射由 onChanged state=complete 时清理，更安全。

      results.forEach((result, idx) => {
        if (result && result.ok) {
          if (result.completed) {
            completed.push(newItems[idx].id);
          } else {
            started.push(newItems[idx].id);
          }
        } else if (result && result.retrying) {
          retrying.push(newItems[idx].id);
        } else {
          console.warn('[DownloadService] download failed:', newItems[idx].id, result && result.error);
          failed.push(newItems[idx].id);
        }
      });
    }

    return {
      downloaded: completed,
      started,
      inProgress: inProgress.map(i => i.id),
      retrying,
      duplicates: duplicates.map(i => i.id),
      failed,
      invalid,
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
    const task = this._findTaskById(taskId);
    if (!task) return { ok: false, error: 'task_not_found' };
    if (task.status !== 'failed') return { ok: false, error: 'task_not_failed' };

    this._clearRetryTimer(task.id);
    this._updateTask(task.id, {
      status: 'pending',
      downloadId: null,
      listenerHit: null,
      retryCount: 0,
      maxRetries: MAX_AUTO_RETRIES,
      retryAt: null,
      error: null
    });
    this._pendingFilenames.set(task.url, task.expectedFilename);
    await this._persistPending();
    return this._startTask(task);
  }

  async clearTasks(filter) {
    const removed = filter && filter !== 'all'
      ? this._tasks.filter(t => t.status === filter)
      : this._tasks.slice();
    if (filter && filter !== 'all') {
      this._tasks = this._tasks.filter(t => t.status !== filter);
    } else {
      this._tasks = [];
    }
    removed.forEach(task => {
      this._clearRetryTimer(task.id);
      const hasReplacement = this._tasks.some(item => item.url === task.url &&
        (item.status === 'pending' || item.status === 'downloading' || item.status === 'retrying'));
      if (!hasReplacement) this._pendingFilenames.delete(task.url);
      if (!hasReplacement && task.downloadId !== null) {
        this._pendingFilenamesById.delete(task.downloadId);
      }
    });
    await this._persistTasks();
    await this._persistPending();
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
