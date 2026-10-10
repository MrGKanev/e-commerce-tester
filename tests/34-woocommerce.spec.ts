import { test, expect } from './fixtures';
import { BASE, CATALOG_URL, SEARCH_TERM, goto, waitForContent } from './helpers';
import { storefrontRoute } from '../scripts/platform-config';
import { readSiteSettings } from '../config/site-settings';
import { pageInventory } from './inventory';
import { verifyEmptyCart } from './storefront-assertions';
import { CommerceUnverified } from '../scripts/storefront-model';
import { auditWooCommerce, type WooKind } from './platforms/woocommerce';

test.describe('34 · WooCommerce storefront', { tag: ['@full'] }, () => {
  test('homepage content and navigation render', { tag: '@smoke' }, async ({ page }) => {
    await goto(page);
    await expect(page).not.toHaveTitle('');
    await expect(page.locator('main,[role="main"]').first()).toBeVisible();
    expect(await page.locator('a[href]').count()).toBeGreaterThan(0);
  });
  test('catalogue renders without an HTTP error', { tag: '@smoke' }, async ({ page }) => {
    const response = await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
    await waitForContent(page);
  });
  test('empty cart has a visible indication and no UI/API items', async ({ page }, info) => {
    try {
      await verifyEmptyCart(page, info);
    } catch (error) {
      if (!(error instanceof CommerceUnverified)) throw error;
      info.annotations.push({ type: 'cart-unverified', description: error.message });
      test.skip(true, error.message);
    }
  });
  test('product search renders in the configured storefront', async ({ page }) => {
    const response = await page.goto(
      storefrontRoute(readSiteSettings(), BASE, 'search', SEARCH_TERM),
      { waitUntil: 'domcontentloaded' },
    );
    expect(response?.status()).toBeLessThan(400);
    await waitForContent(page);
  });
  test(
    'UI adds the exact available product or variation',
    { tag: ['@smoke', '@commerce'] },
    async ({ page }, info) => runKind(page, info, 'available'),
  );
  const cases: Array<[WooKind, string]> = [
    ['price', 'product/UI/cart prices agree with WooCommerce precision and taxes'],
    ['schema', 'JSON-LD offer or range agrees with public WooCommerce prices'],
    ['unavailable', 'unavailable products or variations block purchase'],
    ['checkout', 'cart reaches a checkout contact form without placing an order'],
  ];
  for (const [kind, title] of cases)
    test(title, { tag: '@commerce' }, async ({ page }, info) => runKind(page, info, kind));
});
async function runKind(
  page: import('@playwright/test').Page,
  info: import('@playwright/test').TestInfo,
  kind: WooKind,
) {
  const disabled =
    readSiteSettings().capabilities.commerceConsistency === false ||
    (kind === 'checkout' &&
      (readSiteSettings().capabilities.checkout === false ||
        readSiteSettings().checkout.contact === 'not-applicable'));
  if (disabled)
    info.annotations.push({
      type: 'not-applicable',
      description: 'WooCommerce scenario explicitly disabled',
    });
  test.skip(disabled, 'Commerce/checkout capability disabled');
  const products = pageInventory().filter(entry => entry.type === 'product');
  test.skip(!products.length, 'No configured/discovered WooCommerce products');
  test.setTimeout(Math.max(180000, products.length * 180000));
  const unknown: string[] = [];
  for (const product of products)
    await test.step(product.url, async () => {
      try {
        await auditWooCommerce(page, info, product.url, kind);
      } catch (error) {
        if (!(error instanceof CommerceUnverified)) throw error;
        info.annotations.push({ type: 'commerce-unverified', description: error.message });
        unknown.push(error.message);
      }
    });
  test.skip(unknown.length > 0, [...new Set(unknown)].join('; '));
}
