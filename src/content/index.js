import { injectLightbox, openLightbox } from './Lightbox';

class ContentScript {
  constructor() {
    this.init();
  }

  init() {
    this.listenForMediaEvents();
    this.listenForCommands();
    injectLightbox();
  }

  listenForMediaEvents() {
    window.addEventListener('x-media-intercepted', (e) => {
      const items = e.detail;
      if (items && items.length > 0) {
        chrome.runtime.sendMessage({
          action: 'media_intercepted',
          items: items
        }).catch(() => {});
      }
    });
  }

  listenForCommands() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'show_lightbox') {
        openLightbox(message.item);
      }
    });
  }
}

new ContentScript();
