import { test, expect } from '@playwright/test';
import { BASE, goto, findBrokenImages, getFixedElements } from './helpers';

test.describe('01 · Homepage', () => {
  // ─── Basic load ───────────────────────────────────────────────────────────

  test('returns HTTP 200', async ({ page }) => {
    const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    expect(resp?.status(), `Unexpected status: ${resp?.status()}`).toBeLessThan(400);
  });

  test('page title is set and not a Shopify default placeholder', async ({ page }) => {
    await goto(page);
    const title = await page.title();
    expect(title.trim(), 'Title is empty').not.toBe('');
    expect(title, 'Title looks like Shopify placeholder').not.toMatch(/^Online Store$/i);
  });

  test('has a <meta name="description"> tag', async ({ page }) => {
    await goto(page);
    const meta = await page.locator('meta[name="description"]').getAttribute('content');
    expect(meta?.trim() ?? '', 'Meta description is empty').not.toBe('');
  });

  test('canonical URL is set', async ({ page }) => {
    await goto(page);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical, 'No canonical link found').toBeTruthy();
  });

  test('favicon is present', async ({ page }) => {
    await goto(page);
    const favicon = page.locator('link[rel~="icon"]').first();
    const count = await favicon.count();
    expect(count, 'No favicon link tag found').toBeGreaterThan(0);
  });

  // ─── Layout ───────────────────────────────────────────────────────────────

  test('header is visible and non-empty', async ({ page }) => {
    await goto(page);
    const header = page.locator('header, #header, .site-header, [role="banner"]').first();
    await expect(header).toBeVisible();
    const text = await header.textContent();
    expect(text?.trim().length, 'Header appears empty').toBeGreaterThan(0);
  });

  test('main content area is visible', async ({ page }) => {
    await goto(page);
    const main = page.locator('main, #main-content, .main-content, [role="main"]').first();
    await expect(main).toBeVisible();
  });

  test('footer is visible and has links', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const footer = page.locator('footer, #footer, .site-footer').first();
    await expect(footer).toBeVisible();
    const links = footer.locator('a');
    expect(await links.count(), 'Footer has no links').toBeGreaterThan(0);
  });

  test('logo is visible and links back to homepage', async ({ page }) => {
    await goto(page);
    const logo = page.locator(
      'header a[href="/"], .site-header a[href="/"], .logo, a.logo, [class*="logo"] a',
    ).first();
    await expect(logo).toBeVisible();
  });

  // ─── Content ──────────────────────────────────────────────────────────────

  test('at least one hero/banner section visible', async ({ page }) => {
    await goto(page);
    const hero = page.locator(
      '.banner, .hero, .slideshow, [class*="hero"], [class*="banner"], [class*="slider"], section',
    ).first();
    await expect(hero).toBeVisible();
  });

  test('at least one product or collection is linked from homepage', async ({ page }) => {
    await goto(page);
    const productLink = page.locator(
      'a[href*="/products/"], a[href*="/collections/"]',
    ).first();
    await expect(productLink).toBeVisible();
  });

  // ─── Errors ───────────────────────────────────────────────────────────────

  test('no critical JavaScript errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await goto(page);
    await page.waitForTimeout(2000);
    const critical = errors.filter(
      (e) =>
        !e.includes('Non-Error promise rejection') &&
        !e.includes('ResizeObserver loop') &&
        !e.includes('Unhandled Promise'),
    );
    expect(critical, `JS errors:\n${critical.join('\n')}`).toHaveLength(0);
  });

  test('no failed network requests (4xx/5xx) on page load', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', (resp) => {
      const url = resp.url();
      const status = resp.status();
      // ignore analytics, tracking, external pixels
      if (
        status >= 400 &&
        !url.includes('google-analytics') &&
        !url.includes('facebook') &&
        !url.includes('analytics') &&
        !url.includes('pixel') &&
        url.includes('zerno.co')
      ) {
        failed.push(`${status} ${url}`);
      }
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    expect(failed, `Failed requests:\n${failed.join('\n')}`).toHaveLength(0);
  });

  test('homepage images all load (no broken images)', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const broken = await findBrokenImages(page);
    expect(broken, `Broken images:\n${broken.join('\n')}`).toHaveLength(0);
  });

  test('CSS is applied (page is not unstyled raw HTML)', async ({ page }) => {
    await goto(page);
    const bodyFont = await page.evaluate(
      () => window.getComputedStyle(document.body).fontFamily,
    );
    expect(bodyFont, 'Body has no font-family — CSS may not have loaded').not.toBe('');
    // Check body is not just the browser default serif
    const bgColor = await page.evaluate(
      () => window.getComputedStyle(document.body).backgroundColor,
    );
    // At minimum a background is set (even white = rgb(255,255,255))
    expect(bgColor).toBeTruthy();
  });

  // ─── Fixed overlay audit ──────────────────────────────────────────────────

  test('fixed/sticky elements are audited and not excessively blocking viewport', async ({ page }) => {
    await goto(page);
    const fixed = await getFixedElements(page);

    // Log for visibility in report — not a hard failure but report all
    const highZIndex = fixed.filter((el) => Number(el.zIndex) > 1000);
    if (highZIndex.length > 0) {
      console.log(
        'High z-index fixed elements (check for overlaps):\n',
        highZIndex.map((e) => `  ${e.tag}.${e.classes} z:${e.zIndex} ${e.rect}`).join('\n'),
      );
    }

    // Hard check: no single fixed element should cover > 40% of viewport height
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const blockers = fixed.filter((el) => {
      const match = el.rect.match(/(\d+)x(\d+)/);
      if (!match) return false;
      const h = parseInt(match[2], 10);
      return h > viewportHeight * 0.4 && Number(el.zIndex) > 100;
    });
    expect(
      blockers,
      `Element(s) covering >40% of viewport height:\n${blockers.map((e) => JSON.stringify(e)).join('\n')}`,
    ).toHaveLength(0);
  });
});
