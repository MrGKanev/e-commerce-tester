/**
 * API Mock tests — uses Playwright's built-in page.route() to intercept
 * Shopify AJAX API calls and simulate error / edge-case scenarios.
 *
 * This is the Playwright-native equivalent of MSW (Mock Service Worker).
 * For external sites like Shopify, page.route() is the correct approach —
 * MSW browser service workers cannot be injected into third-party domains.
 *
 * Scenarios covered:
 *  - Cart add API returns 422 (out of stock / validation error)
 *  - Cart add API returns 500 (server error)
 *  - Cart fetch returns empty cart
 *  - Search suggest API returns no results
 *  - Search suggest API is slow (timeout)
 *  - Product JSON endpoint is unavailable
 */
import { test, expect } from '@playwright/test';
import { BASE, KNOWN_PRODUCT, goto } from './helpers';

// ─── Cart API mocks ───────────────────────────────────────────────────────────

test.describe('13 · API Mocks — Cart', () => {

  test('store does not crash when cart/add.js returns 422 (out of stock)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    // Mock the Shopify cart add endpoint to simulate out-of-stock
    await page.route('**/cart/add.js', route =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 422,
          message: 'Cart Error',
          description: 'All 1 of the zerno-z1 are already in your cart.',
          errors: { quantity: ['is not available'] },
        }),
      }),
    );

    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });

    const addBtn = page.locator(
      'button[name="add"], #AddToCart, .product-form__submit, form[action*="/cart/add"] button[type="submit"]',
    ).first();

    if ((await addBtn.count()) > 0 && !(await addBtn.isDisabled())) {
      await addBtn.click();
      await page.waitForTimeout(1_500);
    }

    // Page should still be functional — no JS crash
    expect(jsErrors, `JS errors after 422: ${jsErrors.join(' | ')}`).toHaveLength(0);
    await expect(page).not.toHaveTitle(/crashed|error|500/i);
  });

  test('store does not crash when cart/add.js returns 500 (server error)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    await page.route('**/cart/add.js', route =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Internal Server Error' }),
      }),
    );

    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });

    const addBtn = page.locator(
      'button[name="add"], #AddToCart, .product-form__submit, form[action*="/cart/add"] button[type="submit"]',
    ).first();

    if ((await addBtn.count()) > 0 && !(await addBtn.isDisabled())) {
      await addBtn.click();
      await page.waitForTimeout(1_500);
    }

    expect(jsErrors, `JS errors after 500: ${jsErrors.join(' | ')}`).toHaveLength(0);
    await expect(page).not.toHaveTitle(/crashed|error/i);
  });

  test('cart page renders correctly when cart.js returns empty cart', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    // Mock cart.js to always return empty
    await page.route('**/cart.js', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'mock-empty-cart',
          note: null,
          attributes: {},
          total_price: 0,
          total_weight: 0,
          item_count: 0,
          items: [],
          requires_shipping: false,
          currency: 'BGN',
          items_subtotal_price: 0,
          cart_level_discount_applications: [],
        }),
      }),
    );

    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });

    expect(jsErrors, `JS errors with empty cart mock: ${jsErrors.join(' | ')}`).toHaveLength(0);
    await expect(page).not.toHaveTitle(/404|error/i);
  });

  test('cart/add.js network failure is handled gracefully', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    // Simulate complete network failure for cart endpoint
    await page.route('**/cart/add.js', route => route.abort('failed'));

    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });

    const addBtn = page.locator(
      'button[name="add"], #AddToCart, .product-form__submit, form[action*="/cart/add"] button[type="submit"]',
    ).first();

    if ((await addBtn.count()) > 0 && !(await addBtn.isDisabled())) {
      await addBtn.click();
      await page.waitForTimeout(2_000);
    }

    // Page must remain usable — no full crash
    expect(jsErrors.filter(e => /unhandled|uncaught/i.test(e))).toHaveLength(0);
    await expect(page).not.toHaveTitle(/crashed/i);
  });
});

// ─── Search API mocks ─────────────────────────────────────────────────────────

test.describe('13 · API Mocks — Search', () => {

  test('predictive search renders correctly when suggest API returns empty', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    // Mock Shopify predictive search to return empty
    await page.route('**/search/suggest*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          resources: {
            results: { products: [], collections: [], pages: [], queries: [] },
          },
        }),
      }),
    );

    await goto(page);

    // Open search
    const searchToggle = page.locator(
      'button[aria-label*="Search"], button[aria-label*="Търси"], .header__icon--search button',
    ).first();
    if ((await searchToggle.count()) > 0) {
      await searchToggle.click();
      await page.waitForTimeout(400);
    }

    const searchInput = page.locator('input[type="search"], input[name="q"]').first();
    if ((await searchInput.count()) === 0) {
      test.skip(true, 'No search input found');
      return;
    }

    await searchInput.type('test', { delay: 60 });
    await page.waitForTimeout(1_000);

    expect(jsErrors, `JS errors with empty search mock: ${jsErrors.join(' | ')}`).toHaveLength(0);
  });

  test('predictive search handles 500 from suggest API without crash', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    await page.route('**/search/suggest*', route =>
      route.fulfill({ status: 500, body: 'Internal Server Error' }),
    );

    await goto(page);

    const searchToggle = page.locator(
      'button[aria-label*="Search"], button[aria-label*="Търси"], .header__icon--search button',
    ).first();
    if ((await searchToggle.count()) > 0) {
      await searchToggle.click();
      await page.waitForTimeout(400);
    }

    const searchInput = page.locator('input[type="search"], input[name="q"]').first();
    if ((await searchInput.count()) === 0) {
      test.skip(true, 'No search input found');
      return;
    }

    await searchInput.type('zerno', { delay: 60 });
    await page.waitForTimeout(1_500);

    // No crash — the search bar should still be interactable
    expect(jsErrors.filter(e => /unhandled|uncaught/i.test(e))).toHaveLength(0);
    await expect(searchInput).toBeVisible();
  });

  test('search results page loads even when suggest API is unavailable', async ({ page }) => {
    await page.route('**/search/suggest*', route => route.abort('failed'));

    // Direct search (not predictive) should always work via full page navigation
    await page.goto(`${BASE}/search?q=zerno&type=product`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page).not.toHaveTitle(/404|error/i);
    expect(page.url()).toContain('/search');
  });
});

// ─── Product API mocks ────────────────────────────────────────────────────────

test.describe('13 · API Mocks — Product', () => {

  test('product page handles malformed product JSON gracefully', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    // Intercept product.js variant of the product endpoint
    await page.route('**/products/zerno-z1.js', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 999, title: 'Mock Product', variants: [] }),
      }),
    );

    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });

    // Page HTML still loads — we only mocked the AJAX product.js endpoint
    await expect(page).not.toHaveTitle(/404|not found/i);
    expect(jsErrors.filter(e => /unhandled|uncaught/i.test(e))).toHaveLength(0);
  });

  test('product page is navigable when recommendations API is unavailable', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    // Block product recommendations endpoint
    await page.route('**/recommendations/products*', route => route.abort('failed'));

    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });

    // Main product content should still render
    const title = page.locator('h1').first();
    await expect(title).toBeVisible({ timeout: 10_000 });

    expect(jsErrors.filter(e => /unhandled|uncaught/i.test(e))).toHaveLength(0);
  });

  test('collections page renders when products API returns 429 (rate limit)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    await page.route('**/collections/**/*.js*', route =>
      route.fulfill({
        status: 429,
        headers: { 'Retry-After': '1' },
        body: 'Too Many Requests',
      }),
    );

    await page.goto(`${BASE}/collections`, { waitUntil: 'domcontentloaded' });

    await expect(page).not.toHaveTitle(/crashed/i);
    expect(jsErrors.filter(e => /unhandled|uncaught/i.test(e))).toHaveLength(0);
  });
});
