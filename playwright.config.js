const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  use: { baseURL: 'https://www.cryptovault.co.uk' },
  timeout: 30000,
});
