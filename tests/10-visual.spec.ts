import { auditSpelling } from './spelling';
import { readSiteSettings } from '../config/site-settings';
import { clearCart, waitForVisualReady, BASE, KNOWN_PRODUCT, goto } from './helpers';

/** Screenshots compare only with the explicitly approved store version.
 * New images are candidates in Reports; test runs never approve them.
 */
import { approvedScreenshot, viewportClip } from './visual';

import { test, expect } from './fixtures';

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
  maxDiffPixelRatio: readSiteSettings().thresholds.visual.maxDiffPixelRatio,
  animations: 'disabled',
} as const;

async function maskDynamic(page: import('@playwright/test').Page) {
  return page
    .locator(DYNAMIC_MASKS)
    .all()
    .then(els => (els.length ? els : []));
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('10 · Visual regression', { tag: ['@full', '@visual'] }, () => {
  // ── Homepage ───────────────────────────────────────────────────────────────

  test('homepage — above the fold', async ({ page }, testInfo) => {
    await goto(page);
    await waitForVisualReady(page);
    await auditSpelling(page, testInfo);

    // Clip to viewport so scroll position is irrelevant
    await approvedScreenshot(page, 'homepage-fold.png', testInfo, {
      ...SNAP_OPTS,
      clip: viewportClip(page),
      mask: await maskDynamic(page),
    });
  });

  test('homepage — header / navigation', async ({ page }, testInfo) => {
    await goto(page);
    const header = page.locator('header, #header, .site-header, [role="banner"]').first();
    await expect(header).toBeVisible();
    await waitForVisualReady(page);
    await auditSpelling(page, testInfo);

    await approvedScreenshot(header, 'header.png', testInfo, {
      ...SNAP_OPTS,
      mask: await maskDynamic(page),
    });
  });

  // ── Product page ──────────────────────────────────────────────────────────

  test('product page — hero (image + title + price + ATC)', async ({ page }, testInfo) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
    await waitForVisualReady(page);
    await auditSpelling(page, testInfo);

    // Mask the price in case it changes (sale, currency rounding)
    const priceMask = page.locator(
      '.price__regular .price-item, .price__regular, .product__price, [data-product-price], .price-item--regular, span.money',
    );

    const productSection = page
      .locator('.product, .product-single, [class*="product-template"], main')
      .first();
    await productSection.waitFor({ state: 'visible' });

    await approvedScreenshot(productSection, 'product-hero.png', testInfo, {
      ...SNAP_OPTS,
      mask: [priceMask, ...(await maskDynamic(page))],
    });
  });

  // ── Cart page ─────────────────────────────────────────────────────────────

  test('cart page — empty state', async ({ page }, testInfo) => {
    // Ensure cart is empty before snapping
    await clearCart(page);
    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
    await waitForVisualReady(page);
    await auditSpelling(page, testInfo);

    await approvedScreenshot(page, 'cart-empty.png', testInfo, {
      ...SNAP_OPTS,
      clip: viewportClip(page),
      mask: await maskDynamic(page),
    });
  });

  // ── Mobile ────────────────────────────────────────────────────────────────

  test('homepage — mobile viewport (390 px)', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goto(page);
    await waitForVisualReady(page);
    await auditSpelling(page, testInfo);

    await approvedScreenshot(page, 'homepage-mobile.png', testInfo, {
      ...SNAP_OPTS,
      clip: viewportClip(page),
      mask: await maskDynamic(page),
    });
  });

  test('product page — mobile viewport (390 px)', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
    await waitForVisualReady(page);
    await auditSpelling(page, testInfo);

    const priceMask = page.locator('span.money, [data-product-price], .price-item--regular');

    await approvedScreenshot(page, 'product-mobile.png', testInfo, {
      ...SNAP_OPTS,
      clip: viewportClip(page),
      mask: [priceMask, ...(await maskDynamic(page))],
    });
  });
});
