const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  retries: 1,
  use: { baseURL: process.env.BASE_URL || 'https://agenttrustxrpl.com' },
  timeout: 60000,
});
