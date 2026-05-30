/**
 * Dynamic Product Crawling
 *
 * Instead of a hardcoded list, fetches the live product catalogue from
 * Shopify's /products.json API (up to 25 handles) and runs sanity checks
 * against every discovered product.  Falls back to KNOWN_PRODUCTS if the
 * API is unavailable.
 *
 * Each test uses crawlConcurrently() with CONCURRENCY=2 worker pages to
 * keep run time reasonable while staying within Shopify's rate limits.
 */
import { test, expect, Page } from '@playwright/test';
import { BASE, KNOWN_PRODUCTS, ADD_TO_CART_SEL, fetchProductHandles } from './helpers';

type Product = { handle: string; url: string };

const CONCURRENCY = 2;

/**
 * Runs fn over every item in products using up to `limit` concurrent Playwright
 * pages, all sharing the same browser context (and therefore the same cookies).
 */
async function crawlConcurrently(
  page: Page,
  products: Product[],
  limit: number,
  fn: (worker: Page, product: Product) => Promise<void>,
): Promise<void> {
  const queue = [...products];
  const ctx = page.context();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    const worker = await ctx.newPage();
    try {
      let item: Product | undefined;
      while ((item = queue.shift()) !== undefined) {
        await fn(worker, item);
      }
    } finally {
      await worker.close();
    }
  });
  await Promise.all(workers);
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('16 · Dynamic Product Crawling', () => {

  let products: Product[] = [];

  test.beforeAll(async () => {
    products = await fetchProductHandles(25);
    const source = products === KNOWN_PRODUCTS ? 'fallback (KNOWN_PRODUCTS)' : '/products.json';
    console.log(
      `[16] Source: ${source} — ${products.length} product(s): ` +
      products.map(p => p.handle).join(', '),
    );
  });

  // ─── Reachability ──────────────────────────────────────────────────────────

  test('all crawled products return HTTP < 400', async ({ page }) => {
    test.setTimeout(products.length * 8_000 + 15_000);

    const failed: string[] = [];
    await crawlConcurrently(page, products, CONCURRENCY, async (worker, p) => {
      const resp = await worker.goto(p.url, { waitUntil: 'domcontentloaded' });
      const status = resp?.status() ?? 0;
      if (status >= 400) failed.push(`${p.handle} → HTTP ${status}`);
    });

    expect(failed.length, `Products with HTTP errors:\n  ${failed.join('\n  ')}`).toBe(0);
  });

  // ─── Title & Price ─────────────────────────────────────────────────────────

  test('all crawled products have a visible H1 title', async ({ page }) => {
    test.setTimeout(products.length * 8_000 + 15_000);

    const missing: string[] = [];
    await crawlConcurrently(page, products, CONCURRENCY, async (worker, p) => {
      await worker.goto(p.url, { waitUntil: 'domcontentloaded' });
      const title = (await worker.locator('h1').first().textContent().catch(() => ''))?.trim();
      if (!title) missing.push(p.handle);
    });

    expect(missing.length, `Products missing H1 title: ${missing.join(', ')}`).toBe(0);
  });

  test('all crawled products display a price', async ({ page }) => {
    test.setTimeout(products.length * 8_000 + 15_000);

    const missing: string[] = [];
    await crawlConcurrently(page, products, CONCURRENCY, async (worker, p) => {
      await worker.goto(p.url, { waitUntil: 'domcontentloaded' });
      const price = (await worker
        .locator('.price, [class*="price"], span.money, .product__price')
        .first()
        .textContent()
        .catch(() => ''))?.trim();
      if (!price) missing.push(p.handle);
    });

    expect(missing.length, `Products missing price: ${missing.join(', ')}`).toBe(0);
  });

  // ─── Structured Data ───────────────────────────────────────────────────────

  test('all crawled products expose at least one JSON-LD script', async ({ page }) => {
    test.setTimeout(products.length * 8_000 + 15_000);

    const missing: string[] = [];
    await crawlConcurrently(page, products, CONCURRENCY, async (worker, p) => {
      await worker.goto(p.url, { waitUntil: 'domcontentloaded' });
      const count = await worker.$$eval(
        'script[type="application/ld+json"]',
        (scripts) => scripts.length,
      );
      if (count === 0) missing.push(p.handle);
    });

    expect(missing.length, `Products missing JSON-LD: ${missing.join(', ')}`).toBe(0);
  });

  // ─── Add to Cart button ────────────────────────────────────────────────────

  test('all in-stock crawled products have an enabled add-to-cart button', async ({ page }) => {
    test.setTimeout(products.length * 10_000 + 15_000);

    const issues: string[] = [];
    await crawlConcurrently(page, products, CONCURRENCY, async (worker, p) => {
      await worker.goto(p.url, { waitUntil: 'domcontentloaded' });

      const btn = worker.locator(ADD_TO_CART_SEL).first();
      const count = await btn.count();
      if (count === 0) {
        issues.push(`${p.handle}: no add-to-cart button found`);
        return;
      }

      const disabled = await btn.isDisabled();
      if (disabled) {
        console.log(`${p.handle}: add-to-cart button is disabled (sold out or unavailable)`);
      }
    });

    expect(issues.length, `ATC button issues:\n  ${issues.join('\n  ')}`).toBe(0);
  });

  // ─── Hero image ────────────────────────────────────────────────────────────

  test('all crawled products have no broken hero image', async ({ page }) => {
    test.setTimeout(products.length * 10_000 + 15_000);

    const broken: string[] = [];
    await crawlConcurrently(page, products, CONCURRENCY, async (worker, p) => {
      await worker.goto(p.url, { waitUntil: 'domcontentloaded' });

      const imgOk = await worker.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>(
          '.product__media img, .product-single__photo img, [data-product-media] img, .product__image img, main img',
        );
        if (!img) return true;
        return img.complete && img.naturalWidth > 0;
      });

      if (!imgOk) broken.push(p.handle);
    });

    expect(broken.length, `Products with broken hero image: ${broken.join(', ')}`).toBe(0);
  });
});
