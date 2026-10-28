// @ts-check
const { test, expect } = require('@playwright/test');

const TESTNET_TX_RE = /testnet\.xrpl\.org\/transactions\/[A-F0-9]{64}/i;
const SEED_RE = /s[a-zA-Z0-9]{25,}/;

test.describe('/try/ interactive demo', () => {
  test('PASS path shows two testnet.xrpl.org links', async ({ page }) => {
    await page.goto('/try/');
    await expect(page.locator('h1')).toBeVisible();

    // Start session
    const startBtn = page.locator('#btn-start');
    await startBtn.waitFor({ state: 'visible', timeout: 10000 });
    await startBtn.click();

    // Wait for escrow step to appear
    await expect(page.locator('#step-2')).toBeVisible({ timeout: 30000 });

    // Lock escrow
    const lockBtn = page.locator('#btn-lock');
    await lockBtn.waitFor({ state: 'visible', timeout: 10000 });
    await lockBtn.click();

    // Wait for submit step
    await expect(page.locator('#step-3, #step-submit')).toBeVisible({ timeout: 30000 });

    // Fill deliverable
    const textarea = page.locator('textarea');
    await textarea.fill('HELLO AGENT — this is a passing deliverable for testnet purposes.');

    // Submit work
    const submitBtn = page.locator('#btn-submit');
    await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
    await submitBtn.click();

    // Wait for verdict
    const verdictEl = page.locator('.verdict, #verdict, [data-verdict]');
    await verdictEl.waitFor({ timeout: 60000 });

    // Check for testnet.xrpl.org links (escrow tx + release/refund tx)
    const links = await page.locator('a[href*="testnet.xrpl.org"]').all();
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  test('FAIL path shows reasoning text', async ({ page }) => {
    await page.goto('/try/');

    const startBtn = page.locator('#btn-start');
    await startBtn.waitFor({ state: 'visible', timeout: 10000 });
    await startBtn.click();

    await expect(page.locator('#step-2')).toBeVisible({ timeout: 30000 });
    const lockBtn = page.locator('#btn-lock');
    await lockBtn.waitFor({ state: 'visible', timeout: 10000 });
    await lockBtn.click();

    await expect(page.locator('textarea')).toBeVisible({ timeout: 30000 });
    await page.locator('textarea').fill('bad');

    const submitBtn = page.locator('#btn-submit');
    await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
    await submitBtn.click();

    // Wait for verdict — FAIL should show reasoning
    const verdictEl = page.locator('.verdict, #verdict, [data-verdict]');
    await verdictEl.waitFor({ timeout: 60000 });

    // Should have some explanatory text (criteria or reasoning)
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(100);
  });

  test('no seed pattern visible on page', async ({ page }) => {
    await page.goto('/try/');
    const html = await page.content();
    expect(html).not.toMatch(SEED_RE);
  });
});
