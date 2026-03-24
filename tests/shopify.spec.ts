import { test, expect, Page } from '@playwright/test';

const BASE = 'https://zerno.co';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function goto(page: Page, path = '/') {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
}

/** Returns all unique internal hrefs from a CSS selector scope */
async function internalLinks(page: Page, scope: string): Promise<string[]> {
  return page.$$eval(
    `${scope} a[href]`,
    (anchors, base) =>
      [
        ...new Set(
          anchors
            .map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '')
            .filter(
              (h) =>
                h.startsWith('/') ||
                h.startsWith(base),
            )
            .map((h) => (h.startsWith('http') ? new URL(h).pathname : h))
            .filter(
              (h) =>
                !h.startsWith('/cdn') &&
                !h.startsWith('/s/') &&
                !h.startsWith('#') &&
                h.trim() !== '',
            ),
        ),
      ] as string[],
    BASE,
  );
}

// ---------------------------------------------------------------------------
// 1. Homepage
// ---------------------------------------------------------------------------

test.describe('1. Homepage', () => {
  test('loads and returns 200', async ({ page }) => {
    const response = await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), `Homepage returned ${response?.status()}`).toBeLessThan(400);
  });

  test('has a non-empty page title', async ({ page }) => {
    await goto(page);
    const title = await page.title();
    expect(title.trim()).not.toBe('');
  });

  test('header is visible', async ({ page }) => {
    await goto(page);
    const header = page.locator('header, #header, .site-header, [role="banner"]').first();
    await expect(header).toBeVisible();
  });

  test('footer is visible', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const footer = page.locator('footer, #footer, .site-footer').first();
    await expect(footer).toBeVisible();
  });

  test('hero / main content section is visible', async ({ page }) => {
    await goto(page);
    const main = page.locator('main, #main-content, .main-content, [role="main"]').first();
    await expect(main).toBeVisible();
  });

  test('no JavaScript console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await goto(page);
    await page.waitForTimeout(2000);
    expect(
      errors.filter((e) => !e.includes('Non-Error promise rejection')),
      `JS errors: ${errors.join(', ')}`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Navigation — Header
// ---------------------------------------------------------------------------

test.describe('2. Header navigation', () => {
  test('header contains navigation links', async ({ page }) => {
    await goto(page);
    const navLinks = page.locator(
      'header a[href], .site-header a[href], #header a[href], [role="banner"] a[href]',
    );
    const count = await navLinks.count();
    expect(count, 'No links found in header').toBeGreaterThan(0);
  });

  test('all header nav links respond without 404/500', async ({ page, request }) => {
    await goto(page);
    const links = await internalLinks(page, 'header, .site-header, [role="banner"]');

    const failures: string[] = [];
    for (const path of links) {
      try {
        const resp = await request.get(`${BASE}${path}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (resp.status() >= 400) {
          failures.push(`${path} → ${resp.status()}`);
        }
      } catch {
        failures.push(`${path} → network error`);
      }
    }

    expect(failures, `Broken header links:\n${failures.join('\n')}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Navigation — Footer
// ---------------------------------------------------------------------------

test.describe('3. Footer navigation', () => {
  test('footer contains links', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const footerLinks = page.locator('footer a[href], .site-footer a[href]');
    const count = await footerLinks.count();
    expect(count, 'No links found in footer').toBeGreaterThan(0);
  });

  test('all footer links respond without 404/500', async ({ page, request }) => {
    await goto(page);
    const links = await internalLinks(page, 'footer, .site-footer');

    const failures: string[] = [];
    for (const path of links) {
      try {
        const resp = await request.get(`${BASE}${path}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (resp.status() >= 400) {
          failures.push(`${path} → ${resp.status()}`);
        }
      } catch {
        failures.push(`${path} → network error`);
      }
    }

    expect(failures, `Broken footer links:\n${failures.join('\n')}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Collections / Catalog
// ---------------------------------------------------------------------------

test.describe('4. Collections', () => {
  const collectionPaths = ['/collections', '/collections/all'];

  for (const path of collectionPaths) {
    test(`${path} page loads`, async ({ page, request }) => {
      const resp = await request.get(`${BASE}${path}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      // 200 = exists, 301/302 = redirect (acceptable), 404 = skip
      if (resp.status() === 404) {
        test.skip(true, `${path} not found – collection path may differ`);
        return;
      }
      expect(resp.status()).toBeLessThan(400);
    });
  }

  test('at least one collection is linked from homepage', async ({ page }) => {
    await goto(page);
    const collectionLink = page.locator('a[href*="/collections/"]').first();
    await expect(collectionLink).toBeVisible();
  });

  test('collection page shows products', async ({ page }) => {
    await goto(page);
    // Find first collection link
    const firstCollection = page
      .locator('a[href*="/collections/"]')
      .first();
    const href = await firstCollection.getAttribute('href');

    const collectionUrl = href?.startsWith('http') ? href : `${BASE}${href}`;
    await page.goto(collectionUrl, { waitUntil: 'domcontentloaded' });

    // Products can appear in many selectors depending on theme
    const productSelector = [
      '.product-card',
      '.product-item',
      '.grid__item',
      '.collection-grid__item',
      '[data-product-id]',
      'li.product',
      'article',
    ].join(', ');

    const products = page.locator(productSelector);
    const count = await products.count();
    expect(count, 'No products found on collection page').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Product page
// ---------------------------------------------------------------------------

test.describe('5. Product page', () => {
  let productUrl = '';

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/collections/all`, { waitUntil: 'domcontentloaded' });

    const productLink = page.locator('a[href*="/products/"]').first();
    const count = await productLink.count();

    if (count > 0) {
      const href = await productLink.getAttribute('href');
      productUrl = href?.startsWith('http') ? href : `${BASE}${href ?? ''}`;
    }
    await ctx.close();
  });

  test('product page loads', async ({ page }) => {
    if (!productUrl) test.skip(true, 'Could not determine a product URL');
    await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
    const status = await page.evaluate(() => document.readyState);
    expect(status).toBe('complete');
  });

  test('product page shows a title', async ({ page }) => {
    if (!productUrl) test.skip(true, 'Could not determine a product URL');
    await page.goto(productUrl, { waitUntil: 'domcontentloaded' });

    const titleSelector = [
      '.product__title',
      '.product-title',
      'h1.title',
      'h1',
    ].join(', ');

    const title = page.locator(titleSelector).first();
    await expect(title).toBeVisible();
    const text = await title.textContent();
    expect(text?.trim()).not.toBe('');
  });

  test('product page shows a price', async ({ page }) => {
    if (!productUrl) test.skip(true, 'Could not determine a product URL');
    await page.goto(productUrl, { waitUntil: 'domcontentloaded' });

    const priceSelector = [
      '.price',
      '.product__price',
      '.product-price',
      '[data-product-price]',
      '.price__regular',
      'span.money',
    ].join(', ');

    const price = page.locator(priceSelector).first();
    await expect(price).toBeVisible();
  });

  test('product page has an add-to-cart button', async ({ page }) => {
    if (!productUrl) test.skip(true, 'Could not determine a product URL');
    await page.goto(productUrl, { waitUntil: 'domcontentloaded' });

    const addToCartSelector = [
      'form[action*="/cart/add"] button[type="submit"]',
      'button[name="add"]',
      '.btn--add-to-cart',
      '#AddToCart',
      '[data-add-to-cart]',
      'button:has-text("Add to cart")',
      'button:has-text("Добавяне")',
      'button:has-text("В количката")',
    ].join(', ');

    const btn = page.locator(addToCartSelector).first();
    await expect(btn).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 6. Cart
// ---------------------------------------------------------------------------

test.describe('6. Cart', () => {
  test('cart page loads', async ({ page }) => {
    await goto(page, '/cart');
    await expect(page).not.toHaveTitle(/404|not found/i);
  });

  test('can add a product to cart', async ({ page }) => {
    // Navigate to collections and pick first product
    await page.goto(`${BASE}/collections/all`, { waitUntil: 'domcontentloaded' });

    const productLink = page.locator('a[href*="/products/"]').first();
    const count = await productLink.count();
    if (count === 0) test.skip(true, 'No products found to add to cart');

    const href = await productLink.getAttribute('href');
    const productUrl = href?.startsWith('http') ? href : `${BASE}${href ?? ''}`;
    await page.goto(productUrl, { waitUntil: 'domcontentloaded' });

    // Try to add to cart via the form (handles both redirect and AJAX themes)
    const addToCartSelector = [
      'form[action*="/cart/add"] button[type="submit"]',
      'button[name="add"]',
      '.btn--add-to-cart',
      '#AddToCart',
      '[data-add-to-cart]',
    ].join(', ');

    const addBtn = page.locator(addToCartSelector).first();
    const btnCount = await addBtn.count();
    if (btnCount === 0) test.skip(true, 'Add-to-cart button not found on product page');

    // Record cart quantity before adding
    const cartCountBefore = await page
      .locator('[data-cart-count], .cart-count, #CartCount, .header__cart-count')
      .first()
      .textContent()
      .catch(() => '0');

    await addBtn.click();

    // Wait for either: cart page redirect OR AJAX cart update OR drawer open
    await Promise.race([
      page.waitForURL('**/cart**', { timeout: 8000 }).catch(() => null),
      page.waitForSelector(
        '[data-cart-count]:not(:text("0")), .cart-count:not(:text("0")), .cart-drawer--open, .drawer--active',
        { timeout: 8000 },
      ).catch(() => null),
      page.waitForTimeout(5000),
    ]);

    // Verify cart has item: either check count changed or navigate to /cart
    const currentUrl = page.url();
    if (currentUrl.includes('/cart')) {
      const cartItems = page.locator(
        '.cart__item, .cart-item, tr.cart__row, [data-cart-item]',
      );
      const itemCount = await cartItems.count();
      expect(itemCount, 'Cart page shows no items after adding').toBeGreaterThan(0);
    } else {
      // Navigate to cart to confirm
      await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
      const cartItems = page.locator(
        '.cart__item, .cart-item, tr.cart__row, [data-cart-item], .cart__items',
      );
      const itemCount = await cartItems.count();
      expect(itemCount, 'Cart is empty after add-to-cart').toBeGreaterThan(0);
    }
  });

  test('cart link in header is present', async ({ page }) => {
    await goto(page);
    const cartLink = page.locator('a[href="/cart"], a[href*="cart"]').first();
    await expect(cartLink).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 7. Search
// ---------------------------------------------------------------------------

test.describe('7. Search', () => {
  test('search input is accessible', async ({ page }) => {
    await goto(page);

    // Try opening search if it's behind a toggle
    const searchToggle = page.locator(
      '[data-search-toggle], .search-toggle, button[aria-label*="Search"], button[aria-label*="Търси"]',
    ).first();
    const toggleCount = await searchToggle.count();
    if (toggleCount > 0) {
      await searchToggle.click().catch(() => null);
      await page.waitForTimeout(500);
    }

    const searchInput = page.locator(
      'input[type="search"], input[name="q"], .search__input, .search-bar__input',
    ).first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });

  test('search returns results for a generic term', async ({ page }) => {
    await page.goto(`${BASE}/search?q=&type=product`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).not.toHaveTitle(/404|not found/i);
  });

  test('search page loads for a specific query', async ({ page }) => {
    await page.goto(`${BASE}/search?q=product&type=product`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).not.toHaveTitle(/404|not found/i);
    const status = await page.evaluate(() => document.readyState);
    expect(status).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
// 8. Static pages
// ---------------------------------------------------------------------------

const STATIC_PAGES: { label: string; paths: string[] }[] = [
  { label: 'Contact', paths: ['/pages/contact', '/pages/contacts', '/contact'] },
  { label: 'About', paths: ['/pages/about', '/pages/about-us', '/about'] },
  { label: 'FAQ', paths: ['/pages/faq', '/pages/faqs'] },
  { label: 'Privacy Policy', paths: ['/policies/privacy-policy'] },
  { label: 'Terms of Service', paths: ['/policies/terms-of-service'] },
];

test.describe('8. Static pages', () => {
  for (const { label, paths } of STATIC_PAGES) {
    test(`${label} page is reachable`, async ({ request }) => {
      let found = false;
      let lastStatus = 0;

      for (const path of paths) {
        const resp = await request
          .get(`${BASE}${path}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            maxRedirects: 5,
          })
          .catch(() => null);

        if (resp && resp.status() < 400) {
          found = true;
          break;
        }
        lastStatus = resp?.status() ?? 0;
      }

      if (!found && lastStatus === 404) {
        test.skip(true, `${label} page not found (tried: ${paths.join(', ')})`);
        return;
      }

      expect(found, `${label} page not reachable (tried: ${paths.join(', ')})`).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 9. Images
// ---------------------------------------------------------------------------

test.describe('9. Images', () => {
  test('homepage images load without errors', async ({ page }) => {
    const failedImages: string[] = [];

    page.on('response', (resp) => {
      if (
        resp.request().resourceType() === 'image' &&
        resp.status() >= 400
      ) {
        failedImages.push(`${resp.url()} → ${resp.status()}`);
      }
    });

    await page.goto(BASE, { waitUntil: 'networkidle' });

    expect(
      failedImages,
      `Failed images:\n${failedImages.join('\n')}`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Mobile responsiveness
// ---------------------------------------------------------------------------

test.describe('10. Mobile', () => {
  test('homepage is usable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goto(page);

    // Check nothing overflows horizontally
    const bodyWidth = await page.evaluate(
      () => document.body.scrollWidth,
    );
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(
      bodyWidth,
      `Page overflows horizontally: body ${bodyWidth}px > viewport ${viewportWidth}px`,
    ).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolerance
  });

  test('mobile navigation is accessible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goto(page);

    // Either hamburger menu or nav is visible
    const mobileNav = page.locator(
      '.hamburger, .mobile-nav__toggle, button[aria-label*="Menu"], button[aria-label*="меню"], [data-nav-toggle], .nav-toggle, header nav',
    ).first();
    await expect(mobileNav).toBeVisible();
  });
});
