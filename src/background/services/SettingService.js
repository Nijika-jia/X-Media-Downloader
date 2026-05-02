import browser from '@/modules/Extension/browser';
import AbstractService from './AbstractService';
import defaultSettings from '@/config/default';

class SettingService extends AbstractService {
  static instance;

  static getService() {
    if (!SettingService.instance) {
      SettingService.instance = new SettingService();
    }
    return SettingService.instance;
  }

  async getSettings() {
    return new Promise(resolve => {
      browser.storage.local.get(null, result => {
        resolve(Object.assign({}, defaultSettings, result));
      });
    });
  }

  async getSetting(key) {
    const settings = await this.getSettings();
    return { [key]: settings[key] };
  }

  async updateSettings(settings) {
    return new Promise(resolve => {
      browser.storage.local.set(settings, () => {
        this.application.settings = Object.assign({}, this.application.settings, settings);
        resolve();
      });
    });
  }
}

export default SettingService;
