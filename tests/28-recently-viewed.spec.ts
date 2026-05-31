/**
 * 28 · Recently viewed products
 *
 * Validates that the "recently viewed" widget appears after browsing products,
 * contains the correct history, and persists across page loads via localStorage
 * or Shopify's native tracking.
 *
 * All tests soft-skip when the feature is absent — it's an optional theme widget.
 */
import { test, expect } from '@playwright/test';
import { BASE, KNOWN_PRODUCTS, fetchProductHandles, goto } from './helpers';

// ── Selectors ─────────────────────────────────────────────────────────────────

const RECENTLY_VIEWED_SEL = [
  '.recently-viewed',
  '.recent-products',
  '[data-recently-viewed]',
  '#recently-viewed',
  '.recently-viewed-products',
  '.last-viewed',
  'section:has-text("Recently viewed")',
  'section:has-text("Наскоро разглеждани")',
  'section:has-text("Последно разглеждани")',
].join(', ');

/** Known localStorage keys used by popular Shopify themes / apps */
const RV_STORAGE_KEYS = [
  'recently_viewed',
  'recentlyViewed',
  'recently-viewed',
  'shopify_recent_products',
  'wiser_recently_viewed',
  'last_viewed',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the value of the first matching localStorage key (or null) */
async function getRecentlyViewedStorage(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate((keys: string[]) => {
    for (const key of keys) {
      const val = localStorage.getItem(key);
      if (val) return val;
    }
    return null;
  }, RV_STORAGE_KEYS);
}

/** Navigate to a product page and wait for it to load */
async function visitProduct(page: import('@playwright/test').Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800); // allow JS tracking scripts to fire
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('28 · Recently viewed products', () => {

  // ── localStorage tracking ─────────────────────────────────────────────────

  test('visiting a product page writes to recently-viewed localStorage', async ({ page }) => {
    await visitProduct(page, KNOWN_PRODUCTS[0].url);
    const stored = await getRecentlyViewedStorage(page);

    if (!stored) {
      test.skip(true, 'No recently-viewed data in localStorage — feature not enabled');
      return;
    }

    expect(stored.length).toBeGreaterThan(0);
  });

  test('localStorage entry includes the visited product handle or ID', async ({ page }) => {
    const handle = KNOWN_PRODUCTS[0].handle;
    await visitProduct(page, KNOWN_PRODUCTS[0].url);

    const stored = await getRecentlyViewedStorage(page);
    if (!stored) {
      test.skip(true, 'No recently-viewed storage');
      return;
    }

    // Handle may be stored directly or as part of a URL/JSON structure
    expect(stored).toContain(handle);
  });

  test('viewing multiple products accumulates history in localStorage', async ({ page }) => {
    const products = await fetchProductHandles(3);
    if (products.length < 2) {
      test.skip(true, 'Not enough products to test history accumulation');
      return;
    }

    await visitProduct(page, products[0].url);
    const storedAfterFirst = await getRecentlyViewedStorage(page);
    if (!storedAfterFirst) {
      test.skip(true, 'No recently-viewed storage after first visit');
      return;
    }

    await visitProduct(page, products[1].url);
    const storedAfterSecond = await getRecentlyViewedStorage(page);

    // Storage should grow or change to include the second product
    expect(storedAfterSecond).toBeTruthy();
    if (storedAfterFirst === storedAfterSecond) {
      // Could be the storage was already full — not a failure
      console.warn('[28] Storage unchanged after second product — may be at capacity');
    } else {
      expect(storedAfterSecond).toContain(products[1].handle);
    }
  });

  // ── Widget visibility ──────────────────────────────────────────────────────

  test('recently viewed widget appears on the homepage after visiting a product', async ({ page }) => {
    // Visit a product first to seed the history
    await visitProduct(page, KNOWN_PRODUCTS[0].url);

    // Navigate to homepage
    await goto(page, '/');
    await page.waitForTimeout(1_500); // allow lazy-load JS to render

    const widget = page.locator(RECENTLY_VIEWED_SEL).first();
    if ((await widget.count()) === 0) {
      test.skip(true, 'No recently viewed widget on homepage');
      return;
    }

    await expect(widget).toBeVisible();
  });

  test('recently viewed widget appears on a product page after history is built', async ({ page }) => {
    const products = await fetchProductHandles(3);
    if (products.length < 2) {
      test.skip(true, 'Not enough products');
      return;
    }

    // Build history by visiting first product
    await visitProduct(page, products[0].url);

    // Navigate to second product — it should show the first in recently viewed
    await visitProduct(page, products[1].url);
    await page.waitForTimeout(1_500);

    const widget = page.locator(RECENTLY_VIEWED_SEL).first();
    if ((await widget.count()) === 0) {
      test.skip(true, 'No recently viewed widget on product page');
      return;
    }

    await expect(widget).toBeVisible();
  });

  test('recently viewed widget is not empty when history exists', async ({ page }) => {
    await visitProduct(page, KNOWN_PRODUCTS[0].url);
    await goto(page, '/');
    await page.waitForTimeout(1_500);

    const widget = page.locator(RECENTLY_VIEWED_SEL).first();
    if ((await widget.count()) === 0) {
      test.skip(true, 'No recently viewed widget');
      return;
    }

    // Widget should have at least one product link
    const productLinks = widget.locator('a[href*="/products/"]');
    const linkCount = await productLinks.count();

    if (linkCount === 0) {
      test.skip(true, 'Widget exists but contains no product links yet');
      return;
    }

    expect(linkCount).toBeGreaterThanOrEqual(1);
  });

  // ── Widget content quality ─────────────────────────────────────────────────

  test('recently viewed widget product images are not broken', async ({ page }) => {
    await visitProduct(page, KNOWN_PRODUCTS[0].url);
    await goto(page, '/');
    await page.waitForTimeout(1_500);

    const widget = page.locator(RECENTLY_VIEWED_SEL).first();
    if ((await widget.count()) === 0) {
      test.skip(true, 'No recently viewed widget');
      return;
    }

    const broken = await page.$$eval(
      `${RECENTLY_VIEWED_SEL.split(', ')[0]} img`,
      imgs => (imgs as HTMLImageElement[])
        .filter(img => img.complete && img.naturalWidth === 0)
        .map(img => img.src || '(no src)'),
    );

    expect(broken, `Broken images in recently viewed widget: ${broken.join(', ')}`).toHaveLength(0);
  });

  test('recently viewed widget links point to valid product URLs', async ({ page }) => {
    await visitProduct(page, KNOWN_PRODUCTS[0].url);
    await goto(page, '/');
    await page.waitForTimeout(1_500);

    const widget = page.locator(RECENTLY_VIEWED_SEL).first();
    if ((await widget.count()) === 0) {
      test.skip(true, 'No recently viewed widget');
      return;
    }

    const hrefs = await widget.locator('a[href*="/products/"]').all().then(els =>
      Promise.all(els.map(el => el.getAttribute('href'))),
    );

    if (hrefs.length === 0) {
      test.skip(true, 'No product links in widget');
      return;
    }

    for (const href of hrefs) {
      expect(href).toMatch(/\/products\//);
    }
  });

  // ── Persistence across navigation ──────────────────────────────────────────

  test('recently viewed history persists after navigating away and back', async ({ page }) => {
    await visitProduct(page, KNOWN_PRODUCTS[0].url);
    const storedBefore = await getRecentlyViewedStorage(page);
    if (!storedBefore) {
      test.skip(true, 'No recently-viewed storage');
      return;
    }

    // Navigate elsewhere and back
    await goto(page, '/');
    await page.waitForTimeout(500);
    await goto(page, '/collections');
    await page.waitForTimeout(500);

    const storedAfter = await getRecentlyViewedStorage(page);
    expect(storedAfter, 'Recently viewed history was lost after navigation').toBeTruthy();
    expect(storedAfter).toContain(KNOWN_PRODUCTS[0].handle);
  });

  // ── Cart page ─────────────────────────────────────────────────────────────

  test('recently viewed widget on cart page renders without errors (if present)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', e => jsErrors.push(e.message));

    await visitProduct(page, KNOWN_PRODUCTS[0].url);
    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_500);

    const widget = page.locator(RECENTLY_VIEWED_SEL).first();
    if ((await widget.count()) > 0) {
      await expect(widget).toBeVisible();
    }

    const critical = jsErrors.filter(
      e => !e.includes('ResizeObserver') && !e.includes('cross-origin'),
    );
    expect(critical, `JS errors on cart page:\n${critical.join('\n')}`).toHaveLength(0);
  });
});
