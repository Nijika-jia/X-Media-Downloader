import browser from '@/modules/Extension/browser';
import Application from './Application';

class Bootstrap {
  static initializeApplication(application) {
    Bootstrap.emitBeforeBoot(application);
    Bootstrap.bindEvents(application);
  }

  static bindableRuntimeEvents = [
    'onConnect', 'onInstalled', 'onMessage', 'onStartup'
  ];

  static bindEvents(bindableInstance) {
    Bootstrap.bindableRuntimeEvents.forEach(event => {
      if (typeof bindableInstance[event] === 'function') {
        browser.runtime[event].addListener(function () {
          const result = bindableInstance[event].apply(bindableInstance, arguments);
          if (event === 'onMessage') {
            // onMessage 是 async，返回 Promise；捕获异常并回传错误响应，
            // 避免 sendResponse 永不触发导致调用方等待至超时
            if (result && typeof result.then === 'function') {
              result.catch(err => {
                console.error('[Application.onMessage] error:', err);
                const sendResponse = arguments[2];
                if (typeof sendResponse === 'function') {
                  try {
                    sendResponse({ ok: false, error: String((err && err.message) || err) });
                  } catch (e) {}
                }
              });
            }
            return true;
          }
        });
      }
    });
  }

  static emitBeforeBoot(application) {
    if (typeof application.onBeforeBoot === 'function') {
      application.onBeforeBoot.call(application);
    }
  }

  static boot(application) {
    application.onBooted.call(application);
  }
}

const application = Application.createApp();
Bootstrap.initializeApplication(application);

self.oninstall = () => {
  Bootstrap.boot(application);
  self.application = application;
};
