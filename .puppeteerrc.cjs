const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Changes the cache location for Puppeteer to Render's persistent cache
  cacheDirectory: join('/opt/render/.cache/puppeteer'),
};
