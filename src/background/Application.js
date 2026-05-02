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
      let result = await historyService.checkDownloaded(message.ids);
      sendResponse(result);
      return;
    }

    if (message.action === 'media_intercepted') {
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
  }
}

export default Application;

export function app() {
  return Application.app();
}
