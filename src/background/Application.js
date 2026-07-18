import RuntimeError from '@/errors/RuntimeError';
import SettingService from '@/background/services/SettingService';
import browser from '@/modules/Extension/browser';
import defaultSettings from '@/config/default';
import ServiceProvider from '@/background/services/ServiceProvider';
import AbstractPortService from '@/background/services/AbstractPortService';

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
        let existing = result.x_captured_media || [];
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
      // 存储捕获的媒体项到 session storage，供画廊页面使用
      await this.storeCapturedItems(message.items, sender.tab ? sender.tab.id : null);
      let mediaService = this.getService('media');
      if (mediaService && mediaService.broadcast) {
        mediaService.broadcast({
          event: 'media_intercepted',
          items: message.items,
          tabId: sender.tab ? sender.tab.id : null
        });
      }
      try {
        browser.runtime.sendMessage({
          action: 'media_intercepted_forward',
          items: message.items,
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
      await browser.storage.session.set({ x_captured_media: [] });
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

    // 未知 action 兜底：避免调用方因 sendResponse 永不触发而等待至超时
    sendResponse({ ok: false, error: 'unknown_action' });
  }
}

export default Application;

export function app() {
  return Application.app();
}
