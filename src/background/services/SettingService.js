import browser from '@/modules/Extension/browser';
import AbstractService from './AbstractService';
import defaultSettings from '@/config/default';

const SETTING_KEYS = Object.keys(defaultSettings);

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
      browser.storage.local.get(SETTING_KEYS, result => {
        resolve(Object.assign({}, defaultSettings, result));
      });
    });
  }

  async getSetting(key) {
    const settings = await this.getSettings();
    return { [key]: settings[key] };
  }

  async updateSettings(settings) {
    const persistedSettings = {};
    SETTING_KEYS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(settings, key)) {
        persistedSettings[key] = settings[key];
      }
    });

    return new Promise((resolve, reject) => {
      browser.storage.local.set(persistedSettings, () => {
        const error = browser.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        this.application.settings = Object.assign({}, this.application.settings, settings);
        resolve();
      });
    });
  }
}

export default SettingService;
