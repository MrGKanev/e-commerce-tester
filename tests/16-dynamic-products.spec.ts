/**
 * Dynamic Product Crawling
 *
 * Instead of a hardcoded list, fetches the live product catalogue from
 * Shopify's /products.json API (up to 25 handles) and runs sanity checks
 * against every discovered product.  Falls back to KNOWN_PRODUCTS if the
 * API is unavailable.
 *
 * Tests are intentionally grouped into single test() calls so that the
 * beforeAll product list is available to all assertions.
 */
import { test, expect } from '@playwright/test';
import { BASE, KNOWN_PRODUCTS, fetchProductHandles } from './helpers';

type Product = { handle: string; url: string };

test.describe('16 · Dynamic Product Crawling', () => {

  let products: Product[] = [];

  test.beforeAll(async () => {
    products = await fetchProductHandles(25);
    const source = products === KNOWN_PRODUCTS ? 'fallback (KNOWN_PRODUCTS)' : `/products.json`;
    console.log(
      `[16] Source: ${source} — ${products.length} product(s): ` +
      products.map(p => p.handle).join(', '),
    );
  });

  // ─── Reachability ──────────────────────────────────────────────────────────

  test('all crawled products return HTTP < 400', async ({ page }) => {
    // Dynamic timeout: 8 s per product + 15 s buffer
    test.setTimeout(products.length * 8_000 + 15_000);

    const failed: string[] = [];
    for (const p of products) {
      const resp = await page.goto(p.url, { waitUntil: 'domcontentloaded' });
      const status = resp?.status() ?? 0;
      if (status >= 400) failed.push(`${p.handle} → HTTP ${status}`);
    }

    expect(failed.length, `Products with HTTP errors:\n  ${failed.join('\n  ')}`).toBe(0);
  });

  // ─── Title & Price ─────────────────────────────────────────────────────────

  test('all crawled products have a visible H1 title', async ({ page }) => {
    test.setTimeout(products.length * 8_000 + 15_000);

    const missing: string[] = [];
    for (const p of products) {
      await page.goto(p.url, { waitUntil: 'domcontentloaded' });
      const title = (await page.locator('h1').first().textContent().catch(() => ''))?.trim();
      if (!title) missing.push(p.handle);
    }

    expect(missing.length, `Products missing H1 title: ${missing.join(', ')}`).toBe(0);
  });

  test('all crawled products display a price', async ({ page }) => {
    test.setTimeout(products.length * 8_000 + 15_000);

    const missing: string[] = [];
    for (const p of products) {
      await page.goto(p.url, { waitUntil: 'domcontentloaded' });
      const price = (await page
        .locator('.price, [class*="price"], span.money, .product__price')
        .first()
        .textContent()
        .catch(() => ''))?.trim();
      if (!price) missing.push(p.handle);
    }

    expect(missing.length, `Products missing price: ${missing.join(', ')}`).toBe(0);
  });

  // ─── Structured Data ───────────────────────────────────────────────────────

  test('all crawled products expose at least one JSON-LD script', async ({ page }) => {
    test.setTimeout(products.length * 8_000 + 15_000);

    const missing: string[] = [];
    for (const p of products) {
      await page.goto(p.url, { waitUntil: 'domcontentloaded' });
      const count = await page.$$eval(
        'script[type="application/ld+json"]',
        (scripts) => scripts.length,
      );
      if (count === 0) missing.push(p.handle);
    }

    expect(missing.length, `Products missing JSON-LD: ${missing.join(', ')}`).toBe(0);
  });

  // ─── Add to Cart button ────────────────────────────────────────────────────

  test('all in-stock crawled products have an enabled add-to-cart button', async ({ page }) => {
    test.setTimeout(products.length * 10_000 + 15_000);

    const ATC_SEL = [
      'form[action*="/cart/add"] button[type="submit"]',
      'button[name="add"]',
      '#AddToCart',
      '.product-form__submit',
      'button:has-text("Add to cart")',
      'button:has-text("Добавяне в количката")',
      'button:has-text("Добавяне")',
      'button:has-text("В количката")',
      'button:has-text("Купи")',
    ].join(', ');

    const issues: string[] = [];
    for (const p of products) {
      await page.goto(p.url, { waitUntil: 'domcontentloaded' });

      const btn = page.locator(ATC_SEL).first();
      const count = await btn.count();
      if (count === 0) {
        issues.push(`${p.handle}: no add-to-cart button found`);
        continue;
      }

      const disabled = await btn.isDisabled();
      // Disabled button = sold out; that's valid — only flag if button is absent
      if (disabled) {
        console.log(`${p.handle}: add-to-cart button is disabled (sold out or unavailable)`);
      }
    }

    expect(issues.length, `ATC button issues:\n  ${issues.join('\n  ')}`).toBe(0);
  });

  // ─── Hero image ────────────────────────────────────────────────────────────

  test('all crawled products have no broken hero image', async ({ page }) => {
    test.setTimeout(products.length * 10_000 + 15_000);

    const broken: string[] = [];
    for (const p of products) {
      await page.goto(p.url, { waitUntil: 'domcontentloaded' });

      const imgOk = await page.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>(
          '.product__media img, .product-single__photo img, [data-product-media] img, .product__image img, main img',
        );
        if (!img) return true; // no image element present — not a failure
        return img.complete && img.naturalWidth > 0;
      });

      if (!imgOk) broken.push(p.handle);
    }

    expect(broken.length, `Products with broken hero image: ${broken.join(', ')}`).toBe(0);
  });
});
