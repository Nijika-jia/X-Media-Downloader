import AbstractService from './AbstractService';

class AbstractPortService extends AbstractService {
  ports = new Map();

  appendPort(port) {
    if (!this.ports.has(port)) {
      this.ports.set(port, port);
    }

    port.onMessage.addListener((message, port) => {
      if (!message) {
        message = {};
      }
      if (typeof message !== 'object') {
        return;
      }
      if (this.onMessage && typeof this.onMessage === 'function') {
        this.onMessage.call(this, Object.assign(message, { port }));
      }
    });

    port.onDisconnect.addListener(port => {
      if (typeof this.onDisconnect === 'function') {
        this.onDisconnect.call(this, port);
      }
      this.ports.delete(port);
    });
  }

  broadcast(message) {
    this.ports.forEach(port => {
      port.postMessage(message);
    });
  }
}

export default AbstractPortService;
