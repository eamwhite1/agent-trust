// @ts-check
const { test, expect } = require('@playwright/test');

const IS_LOCAL = (process.env.BASE_URL || '').includes('localhost');

test('bad challenge token shows expired state', async ({ page }) => {
  test.skip(IS_LOCAL, 'Requires live backend API — CORS blocks localhost');
  await page.goto('/challenge/?token=bad-token-xyz');
  await expect(page.locator('#state-expired')).toBeVisible({ timeout: 10000 });
});
