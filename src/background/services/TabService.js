import browser from '@/modules/Extension/browser';
import AbstractService from './AbstractService';

class TabService extends AbstractService {
  static instance;

  static getService() {
    if (!TabService.instance) {
      TabService.instance = new TabService();
    }
    return TabService.instance;
  }

  async sendMessageToTab(tabId, message) {
    try {
      return await browser.tabs.sendMessage(tabId, message);
    } catch (error) {
      return null;
    }
  }

  async sendMessageToRuntime(message) {
    try {
      return await browser.runtime.sendMessage(message);
    } catch (error) {
      return null;
    }
  }
}

export default TabService;
