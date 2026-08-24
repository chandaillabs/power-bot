const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Stores Chrome inside the project directory so Render never loses it
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
