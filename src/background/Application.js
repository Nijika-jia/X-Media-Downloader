import RuntimeError from '@/errors/RuntimeError';
import SettingService from '@/background/services/SettingService';
import browser from '@/modules/Extension/browser';
import defaultSettings from '@/config/default';
import ServiceProvider from '@/background/services/ServiceProvider';
import AbstractPortService from '@/background/services/AbstractPortService';
import { normalizeMediaItems, sanitizePathPart } from './mediaValidation';

class Application {
  static instance;

  serviceContainer;

  settings;

  constructor() {
    if (Application.instance) {
      throw new RuntimeError('There\'s already a application instance.');
    }
    this.serviceContainer = new Map();
    this.settings = defaultSettings;
    // 串行化 session storage 写入，避免并发 media_intercepted 消息 get-then-set 互相覆盖丢数据
    this._capturedWriteChain = Promise.resolve();
    // 串行化暂存区写入
    this._stagedWriteChain = Promise.resolve();
  }

  static app() {
    if (!Application.instance) {
      throw new RuntimeError('There isn\'t application instance, Application::createApp need to be called first.');
    }
    return Application.instance;
  }

  static createApp() {
    return Application.instance = new Application();
  }

  getService(serviceName) {
    if (this.serviceContainer.has(serviceName)) {
      return this.serviceContainer.get(serviceName);
    }
    this.serviceContainer.set(
      serviceName,
      ServiceProvider.createService(serviceName, this)
    );
    return this.serviceContainer.get(serviceName);
  }

  async onBeforeBoot() {
    let settingService = this.getService('setting');
    this.settings = await settingService.getSettings();
    this.getService('download');
  }

  onBooted() {
    browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error(error));
  }

  onConnect(port) {
    if (port.name && port.name.indexOf(':') < 0) {
      let portService = this.getService(port.name);
      if (portService instanceof AbstractPortService) {
        portService.appendPort(port);
      } else {
        port.disconnect();
      }
    }
  }

  async onInstalled({ previousVersion, reason }) {
    if (reason === 'install') {
      this.getService('setting').updateSettings(defaultSettings);
    } else if (reason === 'update') {
      let settings = await this.getService('setting').getSettings();
      let installVersion = browser.runtime.getManifest().version;
      if (installVersion !== settings.version) {
        this.getService('setting').updateSettings(
          Object.assign({}, settings, { version: installVersion })
        );
      }
    }
  }

  /**
   * 存储捕获的媒体项到 session storage
   * 通过 promise chain 串行化写入，避免并发 get-then-set 互相覆盖丢数据
   */
  async storeCapturedItems(items, tabId) {
    this._capturedWriteChain = this._capturedWriteChain
      .then(() => this._doStoreCapturedItems(items, tabId))
      .catch(() => {}); // 单次失败不应断开串行链
    return this._capturedWriteChain;
  }

  async _doStoreCapturedItems(items, tabId) {
    return new Promise(resolve => {
      browser.storage.session.get('x_captured_media', result => {
        let existing = Array.isArray(result.x_captured_media)
          ? result.x_captured_media
          : [];
        const existingIds = new Set(existing.map(i => i.id));
        items.forEach(item => {
          if (!existingIds.has(item.id)) {
            item._tabId = tabId;
            existing.push(item);
          }
        });
        // 限制最多 2000 项
        if (existing.length > 2000) {
          existing = existing.slice(-2000);
        }
        browser.storage.session.set({ x_captured_media: existing }, () => resolve());
      });
    });
  }

  async removeCapturedItems(ids) {
    const idSet = new Set((Array.isArray(ids) ? ids : [])
      .filter(id => typeof id === 'string' || typeof id === 'number')
      .map(id => String(id)));
    if (idSet.size === 0) return;

    this._capturedWriteChain = this._capturedWriteChain
      .then(() => new Promise(resolve => {
        browser.storage.session.get('x_captured_media', result => {
          const existing = Array.isArray(result.x_captured_media)
            ? result.x_captured_media
            : [];
          const filtered = existing.filter(item => !idSet.has(String(item.id)));
          browser.storage.session.set({ x_captured_media: filtered }, () => resolve());
        });
      }))
      .catch(() => {});
    return this._capturedWriteChain;
  }

  async clearCapturedItems() {
    this._capturedWriteChain = this._capturedWriteChain
      .then(() => new Promise(resolve => {
        browser.storage.session.set({ x_captured_media: [] }, () => resolve());
      }))
      .catch(() => {});
    return this._capturedWriteChain;
  }

  /**
   * 获取所有捕获的媒体项
   */
  async getCapturedItems() {
    return new Promise(resolve => {
      browser.storage.session.get('x_captured_media', result => {
        resolve(result.x_captured_media || []);
      });
    });
  }

  // ===== 暂存区（按分类暂存，等待打包）=====

  async getStagedItems() {
    return new Promise(resolve => {
      browser.storage.local.get('x_staged_media', result => {
        resolve(result.x_staged_media && typeof result.x_staged_media === 'object'
          ? result.x_staged_media
          : {});
      });
    });
  }

  async _writeStagedItems(map) {
    return new Promise(resolve => {
      browser.storage.local.set({ x_staged_media: map }, () => resolve());
    });
  }

  _queueStagedWrite(writer) {
    this._stagedWriteChain = this._stagedWriteChain
      .then(writer)
      .catch(() => {});
    return this._stagedWriteChain;
  }

  async stageItem(item, category) {
    const normalized = normalizeMediaItems([item]);
    if (normalized.length === 0) return false;
    await this.stageItems(normalized, category);
    return true;
  }

  async stageItems(items, category) {
    if (!Array.isArray(items) || items.length === 0) return;
    return this._queueStagedWrite(async () => {
      const staged = await this.getStagedItems();
      const cat = category == null ? '' : category;
      items.forEach(media => {
        staged[media.id] = {
          id: media.id,
          url: media.url,
          thumb: media.thumb || null,
          type: media.type,
          phash: media.phash || null,
          dhash: media.dhash || null,
          category: cat,
          stagedAt: Date.now()
        };
      });
      await this._writeStagedItems(staged);
    });
  }

  async unstageItems(ids) {
    const idSet = new Set((Array.isArray(ids) ? ids : []).map(String));
    if (idSet.size === 0) return;
    return this._queueStagedWrite(async () => {
      const staged = await this.getStagedItems();
      idSet.forEach(id => {
        delete staged[id];
      });
      await this._writeStagedItems(staged);
    });
  }

  async clearStagedItems() {
    return this._queueStagedWrite(() => this._writeStagedItems({}));
  }

  async onMessage(message, sender, sendResponse) {
    if (message.to === 'ws' && message.action) {
      let [serviceName, methodName] = message.action.split(':');
      let service = this.getService(serviceName);
      let params = { sender };
      if (message.args) {
        for (let name in message.args) {
          params[name] = message.args[name];
        }
      }
      let result = await service[methodName].call(service, params);
      sendResponse(result);
      return;
    }

    if (message.action === 'download_media') {
      let downloadService = this.getService('download');
      let result = await downloadService.downloadMedia({ items: message.items, category: message.category });
      sendResponse(result);
      return;
    }

    if (message.action === 'check_history') {
      let historyService = this.getService('history');
      let result = await historyService.checkDownloaded(message.ids, message.items || null);
      sendResponse(result);
      return;
    }

    if (message.action === 'get_stats') {
      let historyService = this.getService('history');
      let result = await historyService.getStats();
      sendResponse(result);
      return;
    }

    if (message.action === 'get_settings') {
      sendResponse(this.settings);
      return;
    }

    if (message.action === 'update_settings') {
      let settingService = this.getService('setting');
      this.settings = Object.assign({}, this.settings, message.settings);
      await settingService.updateSettings(this.settings);
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'media_intercepted') {
      const items = normalizeMediaItems(message.items);
      if (items.length === 0) {
        sendResponse({ status: 'ok', accepted: 0 });
        return;
      }
      // 存储捕获的媒体项到 session storage，供画廊页面使用
      await this.storeCapturedItems(items, sender.tab ? sender.tab.id : null);
      let mediaService = this.getService('media');
      if (mediaService && mediaService.broadcast) {
        mediaService.broadcast({
          event: 'media_intercepted',
          items,
          tabId: sender.tab ? sender.tab.id : null
        });
      }
      try {
        browser.runtime.sendMessage({
          action: 'media_intercepted_forward',
          items,
          tabId: sender.tab ? sender.tab.id : null
        });
      } catch (e) {}
      sendResponse({ status: 'ok' });
      return;
    }

    if (message.action === 'get_captured_media') {
      let items = await this.getCapturedItems();
      sendResponse({ items });
      return;
    }

    if (message.action === 'clear_captured_media') {
      await this.clearCapturedItems();
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'remove_captured_media') {
      await this.removeCapturedItems(message.ids);
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'update_phash_cache') {
      let historyService = this.getService('history');
      await historyService.updatePhashCache(message.items);
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'get_phash_cache') {
      let historyService = this.getService('history');
      let result = await historyService.getPhashForIds(message.ids || []);
      sendResponse(result);
      return;
    }

    // ===== 下载中心（downloadcenter tab）相关 =====
    if (message.action === 'dc_get_tasks') {
      let downloadService = this.getService('download');
      let result = await downloadService.listTasks();
      sendResponse(result);
      return;
    }

    if (message.action === 'dc_retry') {
      let downloadService = this.getService('download');
      let result = await downloadService.retryTask(message.taskId);
      sendResponse(result);
      return;
    }

    if (message.action === 'dc_clear') {
      let downloadService = this.getService('download');
      let result = await downloadService.clearTasks(message.filter);
      sendResponse(result);
      return;
    }

    if (message.action === 'dc_open_tab') {
      let downloadService = this.getService('download');
      let result = await downloadService.openCenterTab();
      sendResponse(result);
      return;
    }

    // ===== 暂存区（分类暂存，等待打包）=====
    if (message.action === 'get_staged_media') {
      const staged = await this.getStagedItems();
      sendResponse({ items: Object.values(staged) });
      return;
    }

    if (message.action === 'stage_media') {
      const ok = await this.stageItem(message.item, message.category);
      sendResponse({ ok: !!ok });
      return;
    }

    if (message.action === 'stage_media_batch') {
      const items = normalizeMediaItems(message.items);
      await this.stageItems(items, message.category);
      sendResponse({ ok: true, count: items.length });
      return;
    }

    if (message.action === 'unstage_media') {
      await this.unstageItems(message.ids);
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'clear_staged_media') {
      await this.clearStagedItems();
      sendResponse({ ok: true });
      return;
    }

    // ===== 批量打包（zip）相关 =====
    if (message.action === 'zip_prepare') {
      const rawItems = Array.isArray(message.items) ? message.items : [];
      // normalizeMediaItems 只保留白名单字段，分类需要从原始项里按 id 取回
      const categoryById = new Map();
      rawItems.forEach(it => {
        if (it && it.id != null) {
          categoryById.set(String(it.id), it.category == null ? '' : it.category);
        }
      });

      const items = normalizeMediaItems(rawItems);
      if (items.length === 0) {
        sendResponse({ ok: false, error: 'no_valid_items' });
        return;
      }
      const historyService = this.getService('history');
      const checked = await historyService.batchCheckItems(items);
      const newItems = checked.newItems;
      const duplicates = checked.duplicates.length;
      if (newItems.length === 0) {
        sendResponse({ ok: true, count: 0, duplicates });
        return;
      }

      // 每个媒体按自己的分类映射到 zip 内的子文件夹
      const categoryFolders = this.settings.categoryFolders || {};
      const folderFor = (category) => sanitizePathPart(categoryFolders[category], '') || '';

      const batch = {
        batchId: `zip_${Date.now()}`,
        createdAt: Date.now(),
        autoStart: true,
        duplicates,
        items: newItems.map(item => ({
          id: item.id,
          url: item.url,
          thumb: item.thumb || null,
          type: item.type,
          phash: item.phash || null,
          dhash: item.dhash || null,
          folder: folderFor(categoryById.get(String(item.id)) || '')
        }))
      };

      await new Promise(resolve => {
        browser.storage.session.set({ x_zip_batch: batch }, () => resolve());
      });
      const downloadService = this.getService('download');
      await downloadService.openCenterTab();
      try {
        browser.runtime.sendMessage({ action: 'zip_batch_ready', batch });
      } catch (e) {}

      sendResponse({ ok: true, count: newItems.length, duplicates });
      return;
    }

    if (message.action === 'zip_batch_done') {
      const success = Array.isArray(message.items) ? message.items : [];
      if (success.length > 0 && this.settings.enableSaveDownloadHistory !== false) {
        const historyService = this.getService('history');
        await historyService.addItems(success.map(item => ({
          id: item.id,
          type: item.type,
          url: item.url,
          thumb: item.thumb || null,
          phash: item.phash || null,
          dhash: item.dhash || null
        })));
      }
      // 打包成功的项从暂存区移除，失败项保留以便重试
      if (success.length > 0) {
        await this.unstageItems(success.map(item => String(item.id)));
      }
      await new Promise(resolve => {
        browser.storage.session.remove('x_zip_batch', () => resolve());
      });
      const ids = success.map(item => String(item.id));
      try {
        browser.runtime.sendMessage({ action: 'zip_batch_completed', ids });
      } catch (e) {}

      sendResponse({ ok: true, count: success.length });
      return;
    }

    // 未知 action 兜底：避免调用方因 sendResponse 永不触发而等待至超时
    sendResponse({ ok: false, error: 'unknown_action' });
  }
}

export default Application;

export function app() {
  return Application.app();
}
