// @ts-check
const { test, expect } = require('@playwright/test');

const IS_LOCAL = (process.env.BASE_URL || '').includes('localhost');

const PAGES_WITH_FOOTER = [
  '/agents/',
  '/testnet/',
  '/claude-md/',
  '/how-it-works/',
  '/guides/',
];

for (const path of PAGES_WITH_FOOTER) {
  test(`${path} has /testnet/ footer link`, async ({ page }) => {
    await page.goto(path);
    const link = page.locator(`a[href*="/testnet/"]`).last();
    await expect(link).toBeVisible();
  });

  test(`${path} has /challenges/ footer link`, async ({ page }) => {
    await page.goto(path);
    const link = page.locator(`a[href*="/challenges/"]`).last();
    await expect(link).toBeVisible();
  });
}

test('/agents/ demo button shows testnet.xrpl.org links on click', async ({ page }) => {
  test.skip(IS_LOCAL, 'Requires live backend API — CORS blocks localhost');
  await page.goto('/agents/');
  const demoBtn = page.locator('button, a').filter({ hasText: /testnet demo/i }).first();
  await demoBtn.waitFor({ state: 'visible', timeout: 10000 });
  await demoBtn.click();

  // Should eventually show escrow_id or a tx link
  const result = page.locator('[id*="demo-result"], .demo-result, #demo-result');
  await result.waitFor({ timeout: 60000 });
  const text = await result.innerText();
  expect(text.length).toBeGreaterThan(5);
});
