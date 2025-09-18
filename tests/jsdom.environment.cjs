const JSDOMEnvironment = require('jest-environment-jsdom');

class CustomJSDOMEnvironment extends JSDOMEnvironment {
  constructor(config, context) {
    const options = config.testEnvironmentOptions || {};
    if (!options.html) {
      options.html = '<!DOCTYPE html><html><head></head><body></body></html>';
    }
    super({ ...config, testEnvironmentOptions: options }, context);
  }
}

module.exports = CustomJSDOMEnvironment;
