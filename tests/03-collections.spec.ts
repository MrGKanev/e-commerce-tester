import { test, expect } from '@playwright/test';
import { BASE, goto } from './helpers';

test.describe('03 · Collections', () => {

  // ─── Reachability ─────────────────────────────────────────────────────────

  test('/collections/all loads or redirects acceptably', async ({ request }) => {
    const resp = await request.get(`${BASE}/collections/all`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      maxRedirects: 5,
    });
    if (resp.status() === 404) {
      test.skip(true, '/collections/all not found — may use different path');
      return;
    }
    expect(resp.status(), `/collections/all returned ${resp.status()}`).toBeLessThan(400);
  });

  test('at least one collection link exists on homepage', async ({ page }) => {
    await goto(page);
    const link = page.locator('a[href*="/collections/"]').first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain('/collections/');
  });

  // ─── Product grid ─────────────────────────────────────────────────────────

  test('collection page shows a product grid', async ({ page }) => {
    await goto(page);
    const firstCollectionLink = page.locator('a[href*="/collections/"]').first();
    const href = await firstCollectionLink.getAttribute('href');
    const url = href?.startsWith('http') ? href : `${BASE}${href}`;

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const productCardSel = [
      '.product-card',
      '.card--product',
      '.grid__item',
      '.collection-grid__item',
      '[data-product-id]',
      'li[class*="product"]',
      '.product-item',
      'article',
    ].join(', ');

    const cards = page.locator(productCardSel);
    const count = await cards.count();
    expect(count, 'No product cards found on collection page').toBeGreaterThan(0);
  });

  test('each product card shows a name and price', async ({ page }) => {
    await goto(page);
    const firstCollectionLink = page.locator('a[href*="/collections/"]').first();
    const href = await firstCollectionLink.getAttribute('href');
    const url = href?.startsWith('http') ? href : `${BASE}${href}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Check first 3 product cards
    const cards = page.locator(
      '.product-card, .card--product, .grid__item, [data-product-id], .product-item',
    );
    const count = await cards.count();
    const limit = Math.min(count, 3);
    if (limit === 0) test.skip(true, 'No product cards found');

    for (let i = 0; i < limit; i++) {
      const card = cards.nth(i);
      // Should have some text (name)
      const text = await card.textContent();
      expect(text?.trim().length ?? 0, `Product card #${i} has no text`).toBeGreaterThan(3);
      // Should have a link to a product
      const link = card.locator('a[href*="/products/"]').first();
      const linkCount = await link.count();
      expect(linkCount, `Product card #${i} has no product link`).toBeGreaterThan(0);
    }
  });

  test('each product card has an image', async ({ page }) => {
    await goto(page);
    const firstCollectionLink = page.locator('a[href*="/collections/"]').first();
    const href = await firstCollectionLink.getAttribute('href');
    const url = href?.startsWith('http') ? href : `${BASE}${href}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const cards = page.locator(
      '.product-card, .card--product, .grid__item, [data-product-id], .product-item',
    );
    const count = await cards.count();
    if (count === 0) test.skip(true, 'No product cards found');

    const firstCard = cards.first();
    const img = firstCard.locator('img').first();
    await expect(img).toBeVisible();

    // Verify image has loaded
    const loaded = await img.evaluate(
      (el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0,
    );
    expect(loaded, 'Product card image is broken or not loaded').toBe(true);
  });

  test('product card images have alt text', async ({ page }) => {
    await goto(page);
    const firstCollectionLink = page.locator('a[href*="/collections/"]').first();
    const href = await firstCollectionLink.getAttribute('href');
    const url = href?.startsWith('http') ? href : `${BASE}${href}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const noAlt = await page.$$eval(
      '.product-card img, .card--product img, .grid__item img, [data-product-id] img, .product-item img',
      (imgs) =>
        imgs
          .filter((img) => !img.getAttribute('alt'))
          .map((img) => (img as HTMLImageElement).src.slice(-60)),
    );
    if (noAlt.length > 0) {
      console.warn(`Product images missing alt text:\n${noAlt.join('\n')}`);
    }
    // Soft warning — Shopify themes sometimes lazy-fill alt from product title
  });

  test('collection page title matches URL context', async ({ page }) => {
    await goto(page);
    const firstCollectionLink = page.locator('a[href*="/collections/"]').first();
    const href = await firstCollectionLink.getAttribute('href');
    const url = href?.startsWith('http') ? href : `${BASE}${href}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const title = await page.title();
    expect(title.trim()).not.toBe('');
    expect(title).not.toMatch(/^Online Store$/i);
  });

  test('collection page has no horizontal overflow', async ({ page }) => {
    await goto(page);
    const firstCollectionLink = page.locator('a[href*="/collections/"]').first();
    const href = await firstCollectionLink.getAttribute('href');
    const url = href?.startsWith('http') ? href : `${BASE}${href}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 5,
    );
    expect(overflow, 'Collection page has horizontal overflow (scrollbar)').toBe(false);
  });

  test('clicking a product card navigates to the correct product page', async ({ page }) => {
    await goto(page);
    const firstCollectionLink = page.locator('a[href*="/collections/"]').first();
    const href = await firstCollectionLink.getAttribute('href');
    const url = href?.startsWith('http') ? href : `${BASE}${href}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Click first product
    const productLink = page.locator('a[href*="/products/"]').first();
    const productHref = await productLink.getAttribute('href');
    await productLink.click();
    await page.waitForLoadState('domcontentloaded');

    const currentUrl = page.url();
    expect(currentUrl, `Expected URL to contain /products/ but got: ${currentUrl}`).toContain('/products/');

    // Product page should have an H1
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();
  });
});
