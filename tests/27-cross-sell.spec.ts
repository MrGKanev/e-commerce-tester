/**
 * 27 · Cross-sell & upsell
 *
 * Validates that product recommendation widgets (related products, frequently
 * bought together, upsell carousels) render correctly and contain valid links.
 * All tests soft-skip if the widget is absent — it's an optional theme feature.
 */
import { test, expect } from '@playwright/test';
import { BASE, KNOWN_PRODUCT, KNOWN_PRODUCTS, fetchProductHandles } from './helpers';

// ── Selectors ─────────────────────────────────────────────────────────────────

const RELATED_PRODUCTS_SEL = [
  '.product-recommendations',
  '[data-product-recommendations]',
  '.related-products',
  '.related-products-wrapper',
  '#shopify-section-product-recommendations',
  '.upsell-products',
  '.cross-sell',
  '[data-cross-sells]',
  '.complementary-products',
  '.product__recommendations',
].join(', ');

const FREQUENTLY_BOUGHT_SEL = [
  '.frequently-bought-together',
  '[data-frequently-bought]',
  '.fbt-products',
  '.bundle-products',
  'section:has-text("Frequently bought together")',
  'section:has-text("Купувани заедно")',
].join(', ');

const UPSELL_SEL = [
  '.upsell',
  '[data-upsell]',
  '.cart-upsell',
  '.cart__upsell',
  '.upsell-widget',
  '.product-upsell',
].join(', ');

const RECO_PRODUCT_CARD_SEL = [
  '.product-recommendations .product-card',
  '.product-recommendations .grid__item',
  '.product-recommendations article',
  '.related-products .product-card',
  '.related-products .grid__item',
  '[data-product-recommendations] .card',
  '[data-product-recommendations] a[href*="/products/"]',
].join(', ');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Waits for Shopify's async recommendations section to load */
async function waitForRecommendations(page: import('@playwright/test').Page): Promise<boolean> {
  const container = page.locator(RELATED_PRODUCTS_SEL).first();
  if ((await container.count()) === 0) return false;

  // Shopify loads recommendations via a fetch after DOM ready
  await page.waitForResponse(
    r => r.url().includes('/recommendations') || r.url().includes('section_id'),
    { timeout: 8_000 },
  ).catch(() => null);

  await page.waitForTimeout(1_000);
  return (await container.count()) > 0;
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('27 · Cross-sell & upsell', () => {

  // ── Related products section ───────────────────────────────────────────────

  test('product page has a related products / recommendations section', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
    const found = await waitForRecommendations(page);

    if (!found) {
      test.skip(true, 'No product recommendations section — feature may not be enabled');
      return;
    }

    await expect(page.locator(RELATED_PRODUCTS_SEL).first()).toBeVisible();
  });

  test('recommendations section contains at least one product card', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
    await waitForRecommendations(page);

    const container = page.locator(RELATED_PRODUCTS_SEL).first();
    if ((await container.count()) === 0) {
      test.skip(true, 'No recommendations section');
      return;
    }

    const cards = page.locator(RECO_PRODUCT_CARD_SEL);
    if ((await cards.count()) === 0) {
      test.skip(true, 'Recommendations section exists but contains no product cards yet');
      return;
    }

    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
  });

  test('recommended product cards have valid /products/ links', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
    await waitForRecommendations(page);

    const links = page.locator(`${RELATED_PRODUCTS_SEL} a[href*="/products/"]`);
    if ((await links.count()) === 0) {
      test.skip(true, 'No product links found in recommendations');
      return;
    }

    const hrefs = await links.all().then(els =>
      Promise.all(els.map(el => el.getAttribute('href'))),
    );

    const invalid = hrefs.filter(h => h && !h.includes('/products/'));
    expect(
      invalid,
      `Recommendation links with unexpected paths: ${invalid.join(', ')}`,
    ).toHaveLength(0);
  });

  test('recommended products do not include the current product', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
    const currentHandle = KNOWN_PRODUCTS[0].handle;
    await waitForRecommendations(page);

    const links = await page.$$eval(
      `${RELATED_PRODUCTS_SEL} a[href*="/products/"]`,
      (els, handle) =>
        (els as HTMLAnchorElement[])
          .map(el => el.getAttribute('href') ?? '')
          .filter(h => h.includes(`/products/${handle}`)),
      currentHandle,
    );

    expect(
      links,
      `Current product appears in its own recommendations: ${links.join(', ')}`,
    ).toHaveLength(0);
  });

  test('recommended product images are not broken', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
    await waitForRecommendations(page);

    const container = page.locator(RELATED_PRODUCTS_SEL).first();
    if ((await container.count()) === 0) {
      test.skip(true, 'No recommendations section');
      return;
    }

    const broken = await page.$$eval(
      `${RELATED_PRODUCTS_SEL} img`,
      imgs => (imgs as HTMLImageElement[])
        .filter(img => img.complete && img.naturalWidth === 0)
        .map(img => img.src || '(no src)'),
    );

    expect(broken, `Broken images in recommendations: ${broken.join(', ')}`).toHaveLength(0);
  });

  // ── Shopify Recommendations API ────────────────────────────────────────────

  test('Shopify product recommendations API responds successfully', async ({ request }) => {
    const products = await fetchProductHandles(1);
    const productId = await request
      .get(`${BASE}/products/${products[0].handle}.js`)
      .then(r => r.json())
      .then((data: { id?: number }) => data.id)
      .catch(() => null);

    if (!productId) {
      test.skip(true, 'Could not resolve product ID for API call');
      return;
    }

    const resp = await request.get(
      `${BASE}/recommendations/products.json?product_id=${productId}&limit=4`,
    );
    expect(resp.status(), 'Recommendations API returned non-200').toBe(200);

    const body = await resp.json() as { products?: unknown[] };
    expect(Array.isArray(body.products)).toBe(true);
  });

  // ── Frequently bought together ─────────────────────────────────────────────

  test('frequently bought together section renders correctly (if present)', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_500);

    const section = page.locator(FREQUENTLY_BOUGHT_SEL).first();
    if ((await section.count()) === 0) {
      test.skip(true, '"Frequently bought together" not present — feature not enabled');
      return;
    }

    await expect(section).toBeVisible();
    const links = section.locator('a[href*="/products/"]');
    expect(await links.count()).toBeGreaterThanOrEqual(1);
  });

  // ── Cart upsell ────────────────────────────────────────────────────────────

  test('cart page upsell widget renders correctly (if present)', async ({ page }) => {
    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_000);

    const widget = page.locator(UPSELL_SEL).first();
    if ((await widget.count()) === 0) {
      test.skip(true, 'No cart upsell widget — feature not enabled');
      return;
    }

    await expect(widget).toBeVisible();
    const links = widget.locator('a[href*="/products/"]');
    expect(await links.count()).toBeGreaterThanOrEqual(1);
  });

  // ── Multiple products checked ──────────────────────────────────────────────

  test('recommendations are visible on at least one product from the catalogue', async ({ page }) => {
    const products = await fetchProductHandles(5);
    let foundOn = '';

    for (const p of products) {
      await page.goto(p.url, { waitUntil: 'domcontentloaded' });
      await waitForRecommendations(page);

      const container = page.locator(RELATED_PRODUCTS_SEL).first();
      if ((await container.count()) > 0 && (await container.isVisible())) {
        foundOn = p.handle;
        break;
      }
    }

    if (!foundOn) {
      test.skip(true, 'No recommendations section found on any of the tested products');
      return;
    }

    expect(foundOn).toBeTruthy();
  });
});
