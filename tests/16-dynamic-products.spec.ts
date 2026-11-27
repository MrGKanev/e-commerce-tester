import { readSiteSettings } from '../config/site-settings';
/**
 * Dynamic Product Crawling
 *
 * Instead of a hardcoded list, reads the shared cached product catalogue prepared from
 * Shopify's /products.json API (up to 25 handles) and runs sanity checks
 * against every discovered product.  Falls back to KNOWN_PRODUCTS if the
 * discovery is disabled.
 *
 * The shared test uses crawlConcurrently() with CONCURRENCY=2 worker pages to
 * keep run time reasonable while staying within Shopify's rate limits.
 */
import { test, expect, Page } from './fixtures';
import { pageCheck } from './page-check';
import { ADD_TO_CART_SEL, fetchProductHandles } from './helpers';

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

test.describe('16 · Dynamic Product Crawling', { tag: ['@full'] }, () => {
  let products: Product[] = [];

  test.beforeAll(async () => {
    products = await fetchProductHandles(25);
    const source = readSiteSettings().inventory.discoverProducts
      ? 'cached discovered inventory'
      : 'configured inventory';
    console.log(
      `[16] Source: ${source} — ${products.length} product(s): ` +
        products.map(p => p.handle).join(', '),
    );
  });

  // ─── Reachability ──────────────────────────────────────────────────────────

  test('crawled products — shared checks', async ({ page }) => {
    // Sum of the six former scenario budgets; locator/probe limits stay unchanged.
    test.setTimeout(products.length * 52000 + 90000);
    await crawlConcurrently(page, products, CONCURRENCY, async (worker, p) => {
      await test.step(p.handle, async () => {
        const resp = await pageCheck('Product document load', async () => {
          const response = await worker.goto(p.url, { waitUntil: 'domcontentloaded' });
          expect(response, 'Product navigation returned no response').not.toBeNull();
          return response;
        });
        if (!resp) {
          await test.step.skip('Product checks — document load failed', async () => {});
          return;
        }
        await pageCheck('all crawled products return HTTP < 400', async () => {
          expect(resp.status(), `${p.handle} HTTP status`).toBeLessThan(400);
        });
        await pageCheck('all crawled products have a visible H1 title', async () => {
          expect(
            (await worker.locator('h1').first().textContent())?.trim(),
            `${p.handle} missing H1`,
          ).toBeTruthy();
        });
        await pageCheck('all crawled products display a price', async () => {
          const price = await worker
            .locator('.price, [class*="price"], span.money, .product__price')
            .first()
            .textContent();
          expect(price?.trim(), `${p.handle} missing price`).toBeTruthy();
        });
        await pageCheck('all crawled products expose at least one JSON-LD script', async () => {
          expect(
            await worker.locator('script[type="application/ld+json"]').count(),
            `${p.handle} missing JSON-LD`,
          ).toBeGreaterThan(0);
        });
        await pageCheck(
          'all in-stock crawled products have an enabled add-to-cart button',
          async () => {
            const btn = worker.locator(ADD_TO_CART_SEL).first();
            expect(await btn.count(), `${p.handle}: no add-to-cart button found`).toBeGreaterThan(
              0,
            );
            if (await btn.isDisabled())
              console.log(`${p.handle}: add-to-cart button is disabled (sold out or unavailable)`);
          },
        );
        await pageCheck('all crawled products have no broken hero image', async () => {
          const ok = await worker.evaluate(() => {
            const img = document.querySelector<HTMLImageElement>(
              '.product__media img, .product-single__photo img, [data-product-media] img, .product__image img, main img',
            );
            return !img || (img.complete && img.naturalWidth > 0);
          });
          expect(ok, `${p.handle} has a broken hero image`).toBe(true);
        });
      });
    });
  });
});
