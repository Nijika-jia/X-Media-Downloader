import services from '@/background/services';
import RuntimeError from '@/errors/RuntimeError';

class ServiceProvider {
  static createService(serviceName, application) {
    let serviceClass = serviceName.charAt(0).toUpperCase() +
      serviceName.substring(1) + 'Service';

    if (services[serviceClass]) {
      let service = typeof services[serviceClass].getService === 'function'
        ? services[serviceClass].getService()
        : new services[serviceClass];
      service.setApplication(application);
      return service;
    } else {
      throw new RuntimeError(`Service ${serviceName} not found`);
    }
  }
}

export default ServiceProvider;
