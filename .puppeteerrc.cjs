const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Store Chrome permanently in the local project cache
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
