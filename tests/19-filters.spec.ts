/**
 * 19 · Collection filters & sorting
 *
 * Verifies that sort-by URL params work, the product grid survives a re-sort,
 * and that tag/type filters (if available) update the URL correctly.
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE, goto } from './helpers';

const PRODUCT_GRID_SEL = [
  '.product-card',
  '.card--product',
  '.grid__item',
  '[data-product-id]',
  '.product-item',
  'li[class*="product"]',
].join(', ');

/** Returns the first accessible collection URL, or null. */
async function getFirstCollectionUrl(page: Page): Promise<string | null> {
  await goto(page);
  const link = page.locator('a[href*="/collections/"]').first();
  if ((await link.count()) === 0) return null;
  const href = await link.getAttribute('href');
  if (!href) return null;
  return href.startsWith('http') ? href : `${BASE}${href}`;
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('19 · Filters & sorting', () => {

  // ── Sort by ──────────────────────────────────────────────────────────────

  const SORT_OPTIONS = [
    { label: 'price ascending',  param: 'price-ascending' },
    { label: 'price descending', param: 'price-descending' },
    { label: 'title A→Z',        param: 'title-ascending' },
    { label: 'title Z→A',        param: 'title-descending' },
    { label: 'newest',           param: 'created-descending' },
  ];

  for (const { label, param } of SORT_OPTIONS) {
    test(`sort_by=${param} — collection page still shows products`, async ({ page }) => {
      const collectionUrl = await getFirstCollectionUrl(page);
      if (!collectionUrl) test.skip(true, 'No collection link found on homepage');

      const sortUrl = `${collectionUrl}?sort_by=${param}`;
      const resp = await page.goto(sortUrl, { waitUntil: 'domcontentloaded' });
      expect(resp?.status(), `${label}: collection returned ${resp?.status()}`).toBeLessThan(400);

      const cards = page.locator(PRODUCT_GRID_SEL);
      await expect(cards.first()).toBeVisible({ timeout: 10_000 });
      expect(await cards.count(), `${label}: no products visible after sort`).toBeGreaterThan(0);
    });
  }

  test('sort param is preserved in the URL after navigation', async ({ page }) => {
    const collectionUrl = await getFirstCollectionUrl(page);
    if (!collectionUrl) test.skip(true, 'No collection link found');

    await page.goto(`${collectionUrl}?sort_by=price-ascending`, { waitUntil: 'domcontentloaded' });
    const url = new URL(page.url());
    expect(url.searchParams.get('sort_by'), 'sort_by param was stripped from URL').toBe('price-ascending');
  });

  test('collection sort UI dropdown exists (if rendered)', async ({ page }) => {
    const collectionUrl = await getFirstCollectionUrl(page);
    if (!collectionUrl) { test.skip(true, 'No collection link found'); return; }

    await page.goto(collectionUrl, { waitUntil: 'domcontentloaded' });

    const sortSel = [
      'select[name="sort_by"]',
      '[data-sort-by]',
      '.sort-by select',
      '[class*="sort"] select',
      'button[aria-label*="Sort"]',
      'button[aria-label*="sort"]',
      'button[aria-label*="Сортиране"]',
      'label:has-text("Sort")',
      'label:has-text("Сортиране")',
    ].join(', ');

    const sortUi = page.locator(sortSel);
    if ((await sortUi.count()) === 0) {
      test.skip(true, 'No sort UI element found — theme may not expose one');
      return;
    }
    await expect(sortUi.first()).toBeVisible();
  });

  // ── Tag / type filters ───────────────────────────────────────────────────

  test('filter by tag URL returns a valid collection page', async ({ page }) => {
    const collectionUrl = await getFirstCollectionUrl(page);
    if (!collectionUrl) { test.skip(true, 'No collection link found'); return; }

    // Shopify tag filter URL pattern: /collections/{handle}/{tag}
    // We can discover available tags from the page links
    await page.goto(collectionUrl, { waitUntil: 'domcontentloaded' });

    const tagLink = page.locator(
      'a[href*="/collections/"][href*="/collections/"][href$=""],' +
      'a[href*="filter.p.tag"], a[href*="/+"], [data-tag] a',
    ).first();

    // Also look for filter facet links
    const facetLink = page.locator(
      'a[href*="filter"], [class*="filter"] a[href*="/collections/"]',
    ).first();

    const filterLink = (await tagLink.count()) > 0 ? tagLink : facetLink;
    if ((await filterLink.count()) === 0) {
      test.skip(true, 'No filter/tag links found on collection page');
      return;
    }

    const filterHref = await filterLink.getAttribute('href');
    if (!filterHref) {
      test.skip(true, 'Filter link has no href');
      return;
    }

    const filterUrl = filterHref.startsWith('http') ? filterHref : `${BASE}${filterHref}`;
    const resp = await page.goto(filterUrl, { waitUntil: 'domcontentloaded' });
    expect(resp?.status(), `Filter page returned ${resp?.status()}`).toBeLessThan(400);

    // Should still show at least one product or a "no results" message
    const cards = page.locator(PRODUCT_GRID_SEL);
    const noResults = page.locator(
      '[class*="no-result"], [class*="empty"], :has-text("No products"), :has-text("Няма продукти")',
    );
    const hasContent = (await cards.count()) > 0 || (await noResults.count()) > 0;
    expect(hasContent, 'Filter page shows neither products nor a "no results" message').toBe(true);
  });

  test('active filter shows a clear/reset link', async ({ page }) => {
    const collectionUrl = await getFirstCollectionUrl(page);
    if (!collectionUrl) test.skip(true, 'No collection link found');

    // Navigate with a sort param — this is a mild "active filter" state
    await page.goto(`${collectionUrl}?sort_by=price-ascending`, { waitUntil: 'domcontentloaded' });

    const clearSel = [
      'a[href*="reset"]',
      'a:has-text("Clear")',
      'a:has-text("Reset")',
      'button:has-text("Clear")',
      'button:has-text("Reset")',
      'a:has-text("Изчисти")',
      'a:has-text("Нулиране")',
    ].join(', ');

    // This is not universal — many Shopify themes don't show a clear button just for sort
    const clearLink = page.locator(clearSel);
    if ((await clearLink.count()) === 0) {
      test.skip(true, 'Theme does not render a clear/reset link for sort state');
      return;
    }
    await expect(clearLink.first()).toBeVisible();
  });

  // ── Pagination / load more ────────────────────────────────────────────────

  test('collection shows pagination or load-more when there are many products', async ({ page }) => {
    const collectionUrl = await getFirstCollectionUrl(page);
    if (!collectionUrl) test.skip(true, 'No collection link found');

    await page.goto(`${collectionUrl}?sort_by=title-ascending`, { waitUntil: 'domcontentloaded' });

    const cards = page.locator(PRODUCT_GRID_SEL);
    const count = await cards.count();
    if (count < 12) {
      test.skip(true, `Only ${count} products — pagination not expected`);
      return;
    }

    const paginationSel = [
      '.pagination',
      'a[href*="page=2"]',
      'button:has-text("Load more")',
      'button:has-text("Зареди още")',
      '[data-load-more]',
      '[class*="pagination"]',
    ].join(', ');

    const pager = page.locator(paginationSel);
    if ((await pager.count()) === 0) {
      test.skip(true, 'No pagination element found — infinite scroll may be used');
      return;
    }
    await expect(pager.first()).toBeVisible();
  });
});
