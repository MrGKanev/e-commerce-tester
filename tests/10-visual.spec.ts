/**
 * 10 · Visual regression tests
 *
 * Uses Playwright's built-in pixel comparison (toHaveScreenshot) to detect
 * visual regressions that functional tests can't catch — broken layouts,
 * missing images, shifted elements, wrong colours, etc.
 *
 * HOW IT WORKS
 * ─────────────
 * First run (or after intentional design changes):
 *   npx playwright test tests/10-visual.spec.ts --update-snapshots
 *
 * Every subsequent run compares against those saved baselines. A pixel diff
 * above the threshold fails the test with a side-by-side diff image.
 *
 * Snapshots are committed to git so CI catches regressions automatically.
 *
 * THRESHOLDS
 * ──────────
 * maxDiffPixelRatio: 0.03 → up to 3 % of pixels may differ (font rendering,
 * anti-aliasing, minor CDN image compression) without failing.
 *
 * Dynamic content (prices, cart count, chat widgets) is masked so it doesn't
 * cause false positives.
 */

import { test, expect } from '@playwright/test';
import { BASE, KNOWN_PRODUCT, goto } from './helpers';

// Elements that change between runs — hide them from the snapshot
const DYNAMIC_MASKS = [
  // Cart count badge
  '#cart-icon-bubble, [data-cart-count], .cart-count',
  // Live chat widgets
  '[id*="chat"], [class*="chat"], [id*="crisp"], [id*="intercom"]',
  // Cookie banner (handled by global setup, but mask just in case)
  '#onetrust-consent-sdk, .cookie-banner, .cookie-consent',
  // Any countdown timers
  '[class*="countdown"], [class*="timer"]',
].join(', ');

const SNAP_OPTS = {
  maxDiffPixelRatio: 0.03,
  animations: 'disabled',
} as const;

async function maskDynamic(page: import('@playwright/test').Page) {
  return page.locator(DYNAMIC_MASKS).all().then((els) => els.length ? els : []);
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('10 · Visual regression', () => {

  // ── Homepage ───────────────────────────────────────────────────────────────

  test('homepage — above the fold', async ({ page }) => {
    await goto(page);
    await page.waitForLoadState('networkidle');

    // Clip to viewport so scroll position is irrelevant
    await expect(page).toHaveScreenshot('homepage-fold.png', {
      ...SNAP_OPTS,
      clip: { x: 0, y: 0, width: 1280, height: 800 },
      mask: await maskDynamic(page),
    });
  });

  test('homepage — header / navigation', async ({ page }) => {
    await goto(page);
    const header = page.locator('header, #header, .site-header, [role="banner"]').first();
    await header.waitFor({ state: 'visible' });

    await expect(header).toHaveScreenshot('header.png', {
      ...SNAP_OPTS,
      mask: await maskDynamic(page),
    });
  });

  // ── Product page ──────────────────────────────────────────────────────────

  test('product page — hero (image + title + price + ATC)', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'networkidle' });

    // Mask the price in case it changes (sale, currency rounding)
    const priceMask = page.locator(
      '.price__regular .price-item, .price__regular, .product__price, [data-product-price], .price-item--regular, span.money',
    );

    const productSection = page
      .locator('.product, .product-single, [class*="product-template"], main')
      .first();
    await productSection.waitFor({ state: 'visible' });

    await expect(productSection).toHaveScreenshot('product-hero.png', {
      ...SNAP_OPTS,
      mask: [priceMask, ...(await maskDynamic(page))],
    });
  });

  // ── Cart page ─────────────────────────────────────────────────────────────

  test('cart page — empty state', async ({ page }) => {
    // Ensure cart is empty before snapping
    await page.goto(`${BASE}/cart/clear`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' });

    await expect(page).toHaveScreenshot('cart-empty.png', {
      ...SNAP_OPTS,
      clip: { x: 0, y: 0, width: 1280, height: 800 },
      mask: await maskDynamic(page),
    });
  });

  // ── Mobile ────────────────────────────────────────────────────────────────

  test('homepage — mobile viewport (390 px)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goto(page);
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('homepage-mobile.png', {
      ...SNAP_OPTS,
      clip: { x: 0, y: 0, width: 390, height: 844 },
      mask: await maskDynamic(page),
    });
  });

  test('product page — mobile viewport (390 px)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'networkidle' });

    const priceMask = page.locator('span.money, [data-product-price], .price-item--regular');

    await expect(page).toHaveScreenshot('product-mobile.png', {
      ...SNAP_OPTS,
      clip: { x: 0, y: 0, width: 390, height: 844 },
      mask: [priceMask, ...(await maskDynamic(page))],
    });
  });
});
