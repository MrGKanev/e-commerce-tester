import { test, expect } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { BASE, goto } from './helpers';

test.describe('06 · Search', () => {

  // ─── Search UI ─────────────────────────────────────────────────────────────

  test('search icon/button is visible in header', async ({ page }) => {
    await goto(page);
    const searchEl = page.locator(
      'button[aria-label*="Search"], button[aria-label*="search"], button[aria-label*="Търси"], a[href*="/search"], .header__icon--search, [class*="search-toggle"]',
    ).first();
    await expect(searchEl).toBeVisible();
  });

  test('search input appears after clicking search icon', async ({ page }) => {
    await goto(page);

    // Try to find and click a search toggle
    const searchToggle = page.locator(
      'button[aria-label*="Search"], button[aria-label*="search"], button[aria-label*="Търси"], .search-toggle, [data-search-toggle], [class*="search-btn"], .header__icon--search button',
    ).first();

    const toggleCount = await searchToggle.count();
    if (toggleCount > 0) {
      await searchToggle.click();
      await page.waitForTimeout(500);
    }

    const searchInput = page.locator(
      'input[type="search"], input[name="q"], .search__input, .search-form__input, [class*="search-input"]',
    ).first();

    await expect(searchInput).toBeVisible({ timeout: 6000 });
  });

  test('search input accepts text', async ({ page }) => {
    await goto(page);

    const searchToggle = page.locator(
      'button[aria-label*="Search"], button[aria-label*="Търси"], .header__icon--search button, [class*="search-btn"]',
    ).first();
    if ((await searchToggle.count()) > 0) {
      await searchToggle.click();
      await page.waitForTimeout(500);
    }

    const searchInput = page.locator(
      'input[type="search"], input[name="q"]',
    ).first();
    const count = await searchInput.count();
    if (count === 0) test.skip(true, 'No search input found');

    // Use a random commerce term — we just verify the input accepts text
    const randomTerm = faker.commerce.product().toLowerCase();
    await searchInput.fill(randomTerm);
    const value = await searchInput.inputValue();
    expect(value).toBe(randomTerm);
  });

  test('search form submits and shows results page', async ({ page }) => {
    await goto(page);

    const searchToggle = page.locator(
      'button[aria-label*="Search"], button[aria-label*="Търси"], .header__icon--search button',
    ).first();
    if ((await searchToggle.count()) > 0) {
      await searchToggle.click();
      await page.waitForTimeout(400);
    }

    const searchInput = page.locator('input[type="search"], input[name="q"]').first();
    if ((await searchInput.count()) === 0) test.skip(true, 'No search input found');

    await searchInput.fill('zerno');
    await searchInput.press('Enter');
    await page.waitForLoadState('domcontentloaded');

    expect(page.url()).toContain('/search');
    await expect(page).not.toHaveTitle(/404|not found/i);
  });

  // ─── Search results ────────────────────────────────────────────────────────

  test('search results page loads for a known product name', async ({ page }) => {
    await page.goto(`${BASE}/search?q=zerno&type=product`, { waitUntil: 'load' });
    await expect(page).not.toHaveTitle(/404|not found/i);
  });

  test('search results show at least one product for "zerno"', async ({ page }) => {
    await page.goto(`${BASE}/search?q=zerno&type=product`, {
      waitUntil: 'domcontentloaded',
    });

    const resultSel = [
      '.search-result',
      '.product-card',
      '.grid__item',
      '[class*="search"] article',
      '.search__results a[href*="/products/"]',
      'a[href*="/products/"]',
    ].join(', ');

    const results = page.locator(resultSel);
    const count = await results.count();
    expect(count, 'No search results found for "zerno"').toBeGreaterThan(0);
  });

  test('search results for unknown term shows no-results message', async ({ page }) => {
    // Use a random UUID — guaranteed to return no results
    const nonsenseTerm = faker.string.uuid();
    await page.goto(
      `${BASE}/search?q=${encodeURIComponent(nonsenseTerm)}&type=product`,
      { waitUntil: 'domcontentloaded' },
    );

    // Either a "no results" message OR 0 result cards — both are acceptable
    const noResultSel = [
      '[class*="no-result"]',
      '[class*="empty"]',
      'p:has-text("no results")',
      'p:has-text("nothing")',
      'p:has-text("няма")',
      'p:has-text("не е намерен")',
    ].join(', ');

    const noResultMsg = page.locator(noResultSel);
    const productResults = page.locator('a[href*="/products/"]');

    const hasNoResultMsg = (await noResultMsg.count()) > 0;
    const hasResults = (await productResults.count()) > 0;

    // Acceptable: explicit no-result message OR simply no product links
    expect(
      hasNoResultMsg || !hasResults,
      'Search returned results for a nonsense query without a "no results" indicator',
    ).toBe(true);
  });

  test('search page has no horizontal overflow', async ({ page }) => {
    await page.goto(`${BASE}/search?q=zerno`, { waitUntil: 'domcontentloaded' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 5,
    );
    expect(overflow, 'Search page has horizontal overflow').toBe(false);
  });

  // ─── Predictive search (live suggestions) ──────────────────────────────────

  // ─── Faker-driven queries ───────────────────────────────────────────────────

  test('search results page renders without JS errors for random commerce terms', async ({ page }) => {
    const terms = [
      faker.commerce.productAdjective(),
      faker.commerce.productMaterial(),
      faker.word.noun(),
    ];

    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    for (const term of terms) {
      await page.goto(`${BASE}/search?q=${encodeURIComponent(term)}&type=product`, {
        waitUntil: 'domcontentloaded',
      });
      await expect(page).not.toHaveTitle(/404|not found/i);
    }

    expect(jsErrors, `JS errors during search: ${jsErrors.join(' | ')}`).toHaveLength(0);
  });

  test('predictive search dropdown appears while typing (if supported)', async ({ page }) => {
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

    await searchInput.type('zer', { delay: 80 });
    await page.waitForTimeout(800); // debounce

    const predictiveSel = [
      'predictive-search',
      '[id*="predictive"]',
      '[class*="predictive"]',
      '[class*="autocomplete"]',
      '[role="listbox"]',
      '[role="combobox"] + ul',
    ].join(', ');

    const dropdown = page.locator(predictiveSel).first();
    const isVisible = await dropdown.isVisible().catch(() => false);

    if (!isVisible) {
      test.skip(true, 'Predictive search not supported by this theme');
      return;
    }

    // Should have at least one suggestion
    const suggestions = dropdown.locator('a, li, [role="option"]');
    expect(await suggestions.count(), 'Predictive search dropdown is empty').toBeGreaterThan(0);
  });
});
