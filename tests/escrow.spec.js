// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'https://agenttrustxrpl.com';

test('escrow lookup page loads', async ({ page }) => {
  await page.goto(`${BASE}/escrow/`);
  await expect(page.locator('#eid-input')).toBeVisible({ timeout: 10000 });
});

test('testnet page loads with step 1', async ({ page }) => {
  await page.goto(`${BASE}/testnet/`);
  await expect(page.locator('text=create_testnet_wallet').first()).toBeVisible({ timeout: 10000 });
});
