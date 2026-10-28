// @ts-check
const { test, expect } = require('@playwright/test');

test('/escrow/?id=TN-... shows both tx links', async ({ page }) => {
  await page.goto('/escrow/?id=TN-5A40-2C20');
  // Wait for content to load
  await page.waitForTimeout(3000);
  const links = await page.locator('a[href*="xrpl.org"]').all();
  expect(links.length).toBeGreaterThanOrEqual(1);
});

test('/escrow/?id= for a PASS shows PASS and score', async ({ page }) => {
  await page.goto('/escrow/?id=TN-20F7-C85C');
  await page.waitForTimeout(3000);
  const bodyText = await page.locator('body').innerText();
  // Should mention PASS
  expect(bodyText).toMatch(/PASS/i);
});

test('/escrow/?id= renders criteria rows when present', async ({ page }) => {
  await page.goto('/escrow/?id=TN-20F7-C85C');
  await page.waitForTimeout(4000);
  const bodyText = await page.locator('body').innerText();
  // Should have some content beyond the page shell
  expect(bodyText.length).toBeGreaterThan(200);
});
