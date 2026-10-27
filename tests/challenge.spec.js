const { test, expect } = require('@playwright/test');

test('bad challenge token shows expired state', async ({ page }) => {
  await page.goto('/challenge/?token=bad-token-xyz');
  await expect(page.locator('#state-expired')).toBeVisible({ timeout: 10000 });
});
