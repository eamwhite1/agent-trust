// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'https://www.cryptovault.co.uk';

test('escrow lookup page loads', async ({ page }) => {
  await page.goto(`${BASE}/escrow/`);
  await expect(page.locator('input[placeholder*="escrow"]').or(page.locator('input[placeholder*="ID"]'))).toBeVisible({ timeout: 10000 });
});

test('testnet page loads with step 1', async ({ page }) => {
  await page.goto(`${BASE}/testnet/`);
  await expect(page.locator('text=create_testnet_wallet').first()).toBeVisible({ timeout: 10000 });
});
