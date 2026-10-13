import type { TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import { readSiteSettings } from '../config/site-settings';
import { BASE, goto } from './helpers';
const settings = readSiteSettings();
const expected = settings.expectations;
function configured(enabled: boolean, info: TestInfo) {
  if (!enabled)
    info.annotations.push({
      type: 'not-applicable',
      description: 'Store expectation not configured',
    });
  test.skip(!enabled, 'Store expectation not configured');
}
test.describe('37 · Store expectations', { tag: ['@full', '@smoke'] }, () => {
  test('minimum public product count', async ({ request }, info) => {
    configured(!!expected.minProducts, info);
    const endpoint =
      settings.platform === 'shopify'
        ? `${BASE}/products.json?limit=${expected.minProducts}`
        : `${settings.commerce.apiRoot}/products?per_page=${expected.minProducts}`;
    const response = await request.get(endpoint);
    expect(response.ok(), `Product inventory HTTP ${response.status()}`).toBeTruthy();
    const body = await response.json();
    const products = settings.platform === 'shopify' ? body.products : body;
    expect(Array.isArray(products), 'Public product inventory must be an array').toBeTruthy();
    expect(
      products.length,
      'Public product count is below the store expectation',
    ).toBeGreaterThanOrEqual(expected.minProducts);
  });
  test('expected store currency', async ({ request }, info) => {
    configured(!!expected.currency, info);
    const endpoint =
      settings.platform === 'shopify'
        ? `${BASE}/cart.js`
        : `${settings.commerce.apiRoot}/products?per_page=1`;
    const response = await request.get(endpoint);
    expect(response.ok(), `Currency source HTTP ${response.status()}`).toBeTruthy();
    const body = await response.json();
    expect(
      settings.platform === 'shopify' ? body.currency : body[0]?.prices?.currency_code,
      'Expected store currency',
    ).toBe(expected.currency);
  });
  test('expected payment control is visible and enabled', async ({ page }, info) => {
    configured(!!expected.paymentSelector, info);
    await goto(page, expected.paymentPath);
    const payment = page.locator(expected.paymentSelector);
    await expect(payment).toHaveCount(1);
    await expect(payment).toBeVisible();
    await expect(payment).toBeEnabled();
  });
});
