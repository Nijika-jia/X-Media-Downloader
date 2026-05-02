import AbstractPortService from './AbstractPortService';

class MediaService extends AbstractPortService {
  static instance;

  static getService() {
    if (!MediaService.instance) {
      MediaService.instance = new MediaService();
    }
    return MediaService.instance;
  }

  onMessage(args) {
    if (args.action === 'media_intercepted') {
      this.broadcast({
        event: 'media_intercepted',
        items: args.items,
        tabId: args.port.sender ? args.port.sender.tab.id : null
      });
    }
  }
}

export default MediaService;
