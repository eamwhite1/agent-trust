const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  retries: 1,
  use: { baseURL: process.env.BASE_URL || 'https://www.cryptovault.co.uk' },
  timeout: 60000,
});
