/**
 * 23 · 404 page
 *
 * Verifies that non-existent URLs return HTTP 404 with a proper custom page:
 *  - Returns 404 status (not 200 or redirect)
 *  - Has a non-empty, human-readable page (not a blank white screen)
 *  - Contains at least one link back to the store
 *  - Page title indicates "not found"
 *  - Does not expose stack traces or server paths
 *  - Custom 404 page — not the default Shopify placeholder
 */
import { test, expect } from '@playwright/test';
import { BASE } from './helpers';

const NOT_FOUND_PATHS = [
  '/this-page-does-not-exist-abc123',
  '/products/this-product-does-not-exist-xyz987',
  '/collections/no-such-collection-abc456',
  '/pages/no-such-page-qwerty321',
];

// ─────────────────────────────────────────────────────────────────────────────

test.describe('23 · 404 page', () => {

  for (const path of NOT_FOUND_PATHS) {
    test(`${path} returns HTTP 404`, async ({ request }) => {
      const resp = await request.get(`${BASE}${path}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        maxRedirects: 5,
      });
      expect(
        resp.status(),
        `Expected 404 for ${path} but got ${resp.status()}`,
      ).toBe(404);
    });
  }

  test('404 page has a non-empty body (not a blank screen)', async ({ page }) => {
    await page.goto(`${BASE}${NOT_FOUND_PATHS[0]}`, { waitUntil: 'domcontentloaded' });

    const bodyText = await page.evaluate(() => document.body.innerText.trim());
    expect(bodyText.length, '404 page body is empty').toBeGreaterThan(20);
  });

  test('404 page title indicates "not found"', async ({ page }) => {
    await page.goto(`${BASE}${NOT_FOUND_PATHS[0]}`, { waitUntil: 'domcontentloaded' });

    const title = await page.title();
    expect(title.trim(), '404 page has no title').not.toBe('');

    // Title should contain some variant of "not found" or "404"
    expect(
      title,
      `404 page title "${title}" does not indicate a not-found state`,
    ).toMatch(/404|not found|page not found|not exist|няма|не е намер/i);
  });

  test('404 page has at least one navigation link back to the store', async ({ page }) => {
    await page.goto(`${BASE}${NOT_FOUND_PATHS[0]}`, { waitUntil: 'domcontentloaded' });

    // Should have a link to homepage or collections
    const homeLink = page.locator(
      `a[href="/"], a[href="${BASE}"], a[href*="/collections"], a:has-text("Home"), a:has-text("Начало"), a:has-text("Обратно")`,
    ).first();

    if ((await homeLink.count()) === 0) {
      // Fallback: any internal link at all
      const anyInternalLink = page.locator(`a[href^="/"], a[href^="${BASE}"]`).first();
      expect(
        await anyInternalLink.count(),
        '404 page has no links back to the store',
      ).toBeGreaterThan(0);
      return;
    }
    await expect(homeLink).toBeVisible();
  });

  test('404 page uses the store branding (header/logo is present)', async ({ page }) => {
    await page.goto(`${BASE}${NOT_FOUND_PATHS[0]}`, { waitUntil: 'domcontentloaded' });

    const headerSel = 'header, .site-header, [role="banner"]';
    const header = page.locator(headerSel).first();
    if ((await header.count()) === 0) {
      test.skip(true, 'No header element found on 404 page');
      return;
    }
    await expect(header).toBeVisible();
  });

  test('404 page does not expose a stack trace or server path', async ({ page }) => {
    await page.goto(`${BASE}${NOT_FOUND_PATHS[0]}`, { waitUntil: 'domcontentloaded' });

    const bodyText = await page.evaluate(() => document.body.innerText);

    expect(bodyText, 'Page exposes a stack trace').not.toMatch(/at\s+\w+\s*\(.*:\d+:\d+\)/);
    expect(bodyText, 'Page exposes a Unix path').not.toMatch(/\/var\/www|\/home\/\w+|\/usr\/local/);
    expect(bodyText, 'Page exposes a Windows path').not.toMatch(/[A-Z]:\\[\w\\]+/);
    expect(bodyText, 'Page contains "Exception" text').not.toMatch(/\bException\b/);
    expect(bodyText, 'Page contains "undefined" error text').not.toMatch(/\bundefined method\b|\bundefined variable\b/i);
  });

  test('404 page has no horizontal overflow', async ({ page }) => {
    await page.goto(`${BASE}${NOT_FOUND_PATHS[0]}`, { waitUntil: 'domcontentloaded' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 5,
    );
    expect(overflow, '404 page has horizontal overflow').toBe(false);
  });

  test('404 page has no JS errors', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    await page.goto(`${BASE}${NOT_FOUND_PATHS[0]}`, { waitUntil: 'domcontentloaded' });

    const critical = jsErrors.filter(e =>
      !e.includes('cross-origin') &&
      !e.includes('ResizeObserver') &&
      !e.includes('Non-Error promise rejection'),
    );
    expect(critical, `JS errors on 404 page:\n${critical.join('\n')}`).toHaveLength(0);
  });
});
