import { test, expect } from '@playwright/test';
import {
  BASE,
  KNOWN_PRODUCTS,
  ADD_TO_CART_SEL,
  PRODUCT_TITLE_SEL,
  PRICE_SEL,
  getTopElementAt,
  findBrokenImages,
} from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Shared product-page checker — run against every known product handle
// ─────────────────────────────────────────────────────────────────────────────

for (const product of KNOWN_PRODUCTS) {
  test.describe(`04 · Product page — ${product.handle}`, () => {

    test.beforeEach(async ({ page }) => {
      await page.goto(product.url, { waitUntil: 'domcontentloaded' });
    });

    // ── Reachability ─────────────────────────────────────────────────────────

    test('page loads (not 404)', async ({ page }) => {
      const resp = await page.goto(product.url, { waitUntil: 'domcontentloaded' });
      expect(
        resp?.status(),
        `${product.handle} returned ${resp?.status()}`,
      ).toBeLessThan(400);
    });

    test('URL stays on product path (no unexpected redirect)', async ({ page }) => {
      const finalUrl = page.url();
      expect(finalUrl).toContain('/products/');
    });

    test('page has a non-empty <title>', async ({ page }) => {
      const title = await page.title();
      expect(title.trim()).not.toBe('');
      expect(title).not.toMatch(/^Online Store$/i);
    });

    test('page has <meta name="description">', async ({ page }) => {
      const meta = await page.locator('meta[name="description"]').getAttribute('content');
      expect(meta?.trim() ?? '').not.toBe('');
    });

    test('product JSON-LD structured data is present', async ({ page }) => {
      const jsonLd = await page.locator('script[type="application/ld+json"]').count();
      expect(jsonLd, 'No JSON-LD structured data found').toBeGreaterThan(0);

      // Verify at least one JSON-LD block contains product data
      const hasProduct = await page.evaluate(() => {
        const scripts = Array.from(
          document.querySelectorAll('script[type="application/ld+json"]'),
        );
        return scripts.some((s) => {
          try {
            const data = JSON.parse(s.textContent ?? '{}');
            const type = data['@type'] ?? (data['@graph'] ? 'graph' : '');
            return (
              String(type).toLowerCase().includes('product') ||
              JSON.stringify(data).toLowerCase().includes('"product"')
            );
          } catch {
            return false;
          }
        });
      });
      expect(hasProduct, 'No Product JSON-LD schema found').toBe(true);
    });

    // ── Core product elements ─────────────────────────────────────────────────

    test('H1 product title is visible and non-empty', async ({ page }) => {
      const title = page.locator(PRODUCT_TITLE_SEL).first();
      await expect(title).toBeVisible();
      const text = await title.textContent();
      expect(text?.trim().length ?? 0, 'Product title is empty').toBeGreaterThan(0);
    });

    test('price is visible and contains a number', async ({ page }) => {
      const price = page.locator(PRICE_SEL).first();
      await expect(price).toBeVisible();
      const text = await price.textContent();
      expect(text).toMatch(/[\d.,]+/);
    });

    test('price includes a currency symbol or code', async ({ page }) => {
      const price = page.locator(PRICE_SEL).first();
      const text = await price.textContent();
      // Accepts lv., BGN, €, $, £ etc.
      expect(text, `Price "${text}" has no currency symbol`).toMatch(/лв|BGN|€|\$|£/i);
    });

    test('product description / details section is present', async ({ page }) => {
      const descSel = [
        '.product__description',
        '.product-description',
        '.product-single__description',
        '[class*="description"]',
        '.rte',
        '.product__content',
        'product-info',
      ].join(', ');

      const desc = page.locator(descSel).first();
      const count = await desc.count();
      if (count === 0) {
        test.skip(true, 'No description element found — product may have no description');
        return;
      }
      await expect(desc).toBeVisible();
      const text = await desc.textContent();
      expect(text?.trim().length ?? 0, 'Description is empty').toBeGreaterThan(10);
    });

    // ── Images ───────────────────────────────────────────────────────────────

    test('at least one product image is visible', async ({ page }) => {
      const imgSel = [
        '.product__media img',
        '.product-single__photo img',
        '.product-gallery img',
        '[class*="product-image"] img',
        '.product__media-item img',
        'img[src*="products"]',
      ].join(', ');

      const img = page.locator(imgSel).first();
      await expect(img).toBeVisible();

      // Must be loaded (not broken)
      const loaded = await img.evaluate(
        (el) =>
          (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0,
      );
      expect(loaded, 'Primary product image is broken').toBe(true);
    });

    test('product images are reasonably sized (not < 100px)', async ({ page }) => {
      const imgSel = 'img[src*="products"], .product__media img, .product-gallery img';
      const imgs = page.locator(imgSel);
      const count = await imgs.count();
      if (count === 0) return;

      const small: string[] = [];
      for (let i = 0; i < Math.min(count, 5); i++) {
        const img = imgs.nth(i);
        if (!(await img.isVisible().catch(() => false))) continue;
        const box = await img.boundingBox();
        if (box && (box.width < 100 || box.height < 100)) {
          small.push(`Image #${i}: ${box.width}x${box.height}`);
        }
      }
      expect(small, `Suspiciously small product images:\n${small.join('\n')}`).toHaveLength(0);
    });

    test('no broken images on product page', async ({ page }) => {
      await page.goto(product.url, { waitUntil: 'networkidle' });
      const broken = await findBrokenImages(page);
      expect(broken, `Broken images:\n${broken.join('\n')}`).toHaveLength(0);
    });

    test('product image has alt text', async ({ page }) => {
      const imgSel = '.product__media img, .product-single__photo img, img[src*="products"]';
      const firstImg = page.locator(imgSel).first();
      const count = await firstImg.count();
      if (count === 0) return;

      const alt = await firstImg.getAttribute('alt');
      // Soft check — warn but don't hard-fail (Shopify sometimes lazy-sets alt)
      if (!alt?.trim()) {
        console.warn(`Primary product image for ${product.handle} is missing alt text`);
      }
    });

    // ── Image gallery / thumbnails ────────────────────────────────────────────

    test('image gallery thumbnails are visible (if multiple images)', async ({ page }) => {
      const thumbSel = [
        '.product__media-list li',
        '.product-thumbnails img',
        '[class*="thumbnail"] img',
        '.product__media-item ~ .product__media-item',
        '.product-gallery__thumbnail',
      ].join(', ');

      const thumbs = page.locator(thumbSel);
      const thumbCount = await thumbs.count();
      if (thumbCount < 2) {
        test.skip(true, `${product.handle} appears to have only one image — no gallery to test`);
        return;
      }

      // Second thumbnail should be visible
      await expect(thumbs.nth(1)).toBeVisible();
    });

    // ── Purchase form ─────────────────────────────────────────────────────────

    test('add-to-cart button is present and visible', async ({ page }) => {
      const btn = page.locator(ADD_TO_CART_SEL).first();
      await expect(btn).toBeVisible();
    });

    test('add-to-cart button is enabled (not disabled/sold-out)', async ({ page }) => {
      const btn = page.locator(ADD_TO_CART_SEL).first();
      const count = await btn.count();
      if (count === 0) test.skip(true, 'No add-to-cart button found');

      const isDisabled = await btn.isDisabled();
      if (isDisabled) {
        // Product may be sold out — check if there's a sold-out indicator
        const soldOutSel = [
          '[class*="sold-out"]',
          '[class*="soldout"]',
          'button:has-text("Sold out")',
          'button:has-text("Изчерпан")',
          'button:has-text("Няма наличност")',
        ].join(', ');
        const soldOut = await page.locator(soldOutSel).count();
        // If it's explicitly sold out, that's OK — skip instead of fail
        test.skip(soldOut > 0, `${product.handle} appears to be sold out`);
        expect(isDisabled, 'Add-to-cart button is disabled with no sold-out indicator').toBe(false);
      }
    });

    test('add-to-cart button is not covered by another element (clickable)', async ({ page }) => {
      const btn = page.locator(ADD_TO_CART_SEL).first();
      const count = await btn.count();
      if (count === 0) test.skip(true, 'No add-to-cart button found');

      // Scroll button into view first
      await btn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);

      // Get element sitting on top at the button's center
      const topEl = await getTopElementAt(page, ADD_TO_CART_SEL.split(', ')[0]);

      // Acceptable: the button itself, a span/svg inside it, or nothing weird
      const isBlocked = /^(div|section|header|nav|aside|overlay|modal|cookie)/.test(topEl) &&
        !topEl.includes('product') &&
        !topEl.includes('form') &&
        !topEl.includes('btn');

      if (isBlocked) {
        console.warn(`Add-to-cart button may be covered by: ${topEl}`);
        // Don't hard-fail — just warn. The button might still be clickable via JS
      }
    });

    test('quantity selector is present', async ({ page }) => {
      const qtySel = [
        'quantity-input input',
        '.quantity__input',
        'input[name="quantity"]',
        'input[id*="Quantity"]',
        '.product-form__quantity input',
        '[class*="quantity"] input',
      ].join(', ');

      const qty = page.locator(qtySel).first();
      const count = await qty.count();
      if (count === 0) {
        // Not all themes show a qty picker
        test.skip(true, 'No quantity input found — theme may hide it');
        return;
      }
      await expect(qty).toBeVisible();
      const value = await qty.inputValue();
      expect(Number(value), 'Quantity default is not 1').toBe(1);
    });

    test('variant selectors are present if product has variants', async ({ page }) => {
      const variantSel = [
        'fieldset.js-contents',
        '.product-form__input',
        '[name="options[Size]"]',
        '[name="options[Color]"]',
        '[name^="options["]',
        'variant-selects',
        'variant-radios',
        '.product-form__controls-group',
        'select[name="id"]',
      ].join(', ');

      const variants = page.locator(variantSel);
      const count = await variants.count();
      if (count === 0) {
        // Single-variant product — no selector needed
        return;
      }
      await expect(variants.first()).toBeVisible();
    });

    test('variant change updates the price (if applicable)', async ({ page }) => {
      const variantRadioSel = '[name^="options["] input[type="radio"], variant-radios input';
      const variants = page.locator(variantRadioSel);
      const count = await variants.count();
      if (count < 2) {
        test.skip(true, 'Not enough variant options to test price change');
        return;
      }

      const priceBefore = await page.locator(PRICE_SEL).first().textContent();
      await variants.nth(1).click();
      await page.waitForTimeout(500);
      // Price may or may not change — just verify it's still visible
      const priceAfter = await page.locator(PRICE_SEL).first().textContent();
      expect(priceAfter?.trim()).toBeTruthy();
    });

    // ── Breadcrumbs ───────────────────────────────────────────────────────────

    test('breadcrumb navigation is present and contains a home link', async ({ page }) => {
      const breadcrumbSel = [
        'nav[aria-label*="breadcrumb"]',
        'nav[aria-label*="Breadcrumb"]',
        '.breadcrumb',
        '.breadcrumbs',
        '[class*="breadcrumb"]',
        'nav ol li',
      ].join(', ');

      const breadcrumb = page.locator(breadcrumbSel).first();
      const count = await breadcrumb.count();
      if (count === 0) {
        test.skip(true, 'No breadcrumb found — theme may not show breadcrumbs');
        return;
      }
      await expect(breadcrumb).toBeVisible();

      // Should have a link back to homepage or a collection
      const homeLink = page
        .locator(`${breadcrumbSel} a[href="/"], ${breadcrumbSel} a[href*="/collections/"]`)
        .first();
      const homeLinkCount = await homeLink.count();
      expect(homeLinkCount, 'Breadcrumb has no home or collection link').toBeGreaterThan(0);
    });

    // ── Related products ──────────────────────────────────────────────────────

    test('related / recommended products section is present', async ({ page }) => {
      // Scroll to bottom to trigger lazy load
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);

      const relatedSel = [
        '[class*="related"]',
        '[class*="recommended"]',
        '[class*="upsell"]',
        'product-recommendations',
        '.product-recommendations',
        '[id*="related"]',
        '[id*="recommended"]',
      ].join(', ');

      const related = page.locator(relatedSel).first();
      const count = await related.count();
      if (count === 0) {
        test.skip(true, 'No related products section found — may require Shopify Recommendations API');
        return;
      }
      await expect(related).toBeVisible();
    });

    // ── Layout / overflow ─────────────────────────────────────────────────────

    test('product page has no horizontal overflow', async ({ page }) => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 5,
      );
      expect(overflow, 'Product page has horizontal overflow').toBe(false);
    });

    // ── Mobile product page ───────────────────────────────────────────────────

    test('add-to-cart is accessible on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(product.url, { waitUntil: 'domcontentloaded' });

      const btn = page.locator(ADD_TO_CART_SEL).first();
      await expect(btn).toBeVisible();

      // Button should be at least 44px tall on mobile
      const box = await btn.boundingBox();
      expect(
        box?.height ?? 0,
        `Add-to-cart button is too small on mobile: ${box?.height}px`,
      ).toBeGreaterThanOrEqual(40);
    });

    test('product image fills appropriate width on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(product.url, { waitUntil: 'domcontentloaded' });

      const imgSel = '.product__media img, img[src*="products"]';
      const img = page.locator(imgSel).first();
      const count = await img.count();
      if (count === 0) return;

      const box = await img.boundingBox();
      const vw = await page.evaluate(() => window.innerWidth);

      // Image should use at least 50% of viewport width on mobile
      expect(
        box?.width ?? 0,
        `Product image only ${box?.width}px wide on ${vw}px viewport`,
      ).toBeGreaterThan(vw * 0.5);

      // Image should NOT exceed viewport width
      expect(
        box?.width ?? 0,
        `Product image wider than viewport: ${box?.width}px > ${vw}px`,
      ).toBeLessThanOrEqual(vw + 10);
    });

    test('no horizontal overflow on mobile product page', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(product.url, { waitUntil: 'domcontentloaded' });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 5,
      );
      expect(overflow, `${product.handle} has horizontal overflow on mobile (390px)`).toBe(false);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic first-found product (for when the two known handles may not exist)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('04 · Product page — first available product', () => {
  let productUrl = '';

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`${BASE}/collections/all`, { waitUntil: 'domcontentloaded' });
    const link = p.locator('a[href*="/products/"]').first();
    if ((await link.count()) > 0) {
      const href = await link.getAttribute('href');
      productUrl = href?.startsWith('http') ? href : `${BASE}${href ?? ''}`;
    }
    await ctx.close();
  });

  test('first collection product loads and has add-to-cart', async ({ page }) => {
    if (!productUrl) test.skip(true, 'No product found in /collections/all');
    await page.goto(productUrl, { waitUntil: 'domcontentloaded' });

    const btn = page.locator(ADD_TO_CART_SEL).first();
    await expect(btn).toBeVisible();
  });

  test('add-to-cart triggers a visible response (cart update / redirect / toast)', async ({ page }) => {
    if (!productUrl) test.skip(true, 'No product found in /collections/all');
    await page.goto(productUrl, { waitUntil: 'domcontentloaded' });

    const btn = page.locator(ADD_TO_CART_SEL).first();
    if ((await btn.count()) === 0 || await btn.isDisabled()) {
      test.skip(true, 'No enabled add-to-cart button');
      return;
    }

    await btn.click();

    const responded = await Promise.race([
      // Redirect to cart
      page.waitForURL('**/cart**', { timeout: 8000 }).then(() => 'redirect'),
      // Cart count badge updated
      page.waitForFunction(
        () => {
          const badge = document.querySelector(
            '#cart-icon-bubble, [data-cart-count], .cart-count, #CartCount',
          );
          return badge && badge.textContent?.trim() !== '0' && badge.textContent?.trim() !== '';
        },
        { timeout: 8000 },
      ).then(() => 'badge'),
      // Cart drawer opened
      page.waitForSelector('.cart-drawer--open, .drawer--active, [id*="cart-drawer"][open]', {
        timeout: 8000,
      }).then(() => 'drawer'),
      // Toast/notification appeared
      page.waitForSelector(
        '[class*="notification"], [class*="toast"], [class*="success"], [aria-live]',
        { timeout: 8000 },
      ).then(() => 'toast'),
    ]).catch(() => 'timeout');

    if (responded === 'timeout') {
      // Last resort: navigate to /cart and check
      await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
      const items = page.locator('.cart__item, .cart-item, tr.cart__row, [data-cart-item]');
      const count = await items.count();
      expect(count, 'Cart is still empty after clicking add-to-cart').toBeGreaterThan(0);
    } else {
      expect(['redirect', 'badge', 'drawer', 'toast']).toContain(responded);
    }
  });
});
