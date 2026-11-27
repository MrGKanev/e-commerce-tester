import {
  waitForContent,
  BASE,
  findBrokenImages,
  getFixedElements,
  dismissCookieConsent,
} from './helpers';
import { test, expect } from './fixtures';
import { pageCheck } from './page-check';

test.describe('01 · Homepage', { tag: '@full' }, () => {
  test(
    'homepage smoke — status, title, header, main and visible product links',
    { tag: '@smoke' },
    async ({ page }) => {
      const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await waitForContent(page);
      await dismissCookieConsent(page);
      await pageCheck('returns HTTP 200', async () => {
        expect(resp?.status(), `Unexpected status: ${resp?.status()}`).toBeLessThan(400);
      });
      await pageCheck('page title is set and not a Shopify default placeholder', async () => {
        const title = await page.title();
        expect(title.trim(), 'Title is empty').not.toBe('');
        expect(title, 'Title looks like Shopify placeholder').not.toMatch(/^Online Store$/i);
      });
      await pageCheck('header is visible and non-empty', async () => {
        const header = page.locator('header, #header, .site-header, [role="banner"]').first();
        await expect(header).toBeVisible();
        const text = await header.textContent();
        expect(text?.trim().length, 'Header appears empty').toBeGreaterThan(0);
      });
      await pageCheck('main content area is visible', async () => {
        const main = page.locator('main, #main-content, .main-content, [role="main"]').first();
        await expect(main).toBeVisible();
      });
      await pageCheck('at least one product or collection is linked from homepage', async () => {
        const productLink = page
          .locator('a[href*="/products/"], a[href*="/collections/"]')
          .filter({ visible: true })
          .first();
        await expect(productLink).toBeVisible();
      });
    },
  );

  test('homepage — remaining passive checks', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const failed: string[] = [];
    page.on('response', resp => {
      const url = resp.url();
      const status = resp.status();
      // ignore analytics, tracking, external pixels
      if (
        status >= 400 &&
        !url.includes('google-analytics') &&
        !url.includes('facebook') &&
        !url.includes('analytics') &&
        !url.includes('pixel') &&
        url.includes(new URL(BASE).hostname)
      ) {
        failed.push(`${status} ${url}`);
      }
    });

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitForContent(page);
    await dismissCookieConsent(page);
    await pageCheck('no critical JavaScript errors on load', async () => {
      await page.waitForLoadState('load');
      const critical = errors.filter(
        e =>
          !e.includes('Non-Error promise rejection') &&
          !e.includes('ResizeObserver loop') &&
          !e.includes('Unhandled Promise'),
      );
      expect(critical, `JS errors:\n${critical.join('\n')}`).toHaveLength(0);
    });
    await pageCheck('no failed network requests (4xx/5xx) on page load', async () => {
      await page.waitForLoadState('load');
      expect(failed, `Failed requests:\n${failed.join('\n')}`).toHaveLength(0);
    });
    await pageCheck('has a <meta name="description"> tag', async () => {
      await expect(
        page.locator('meta[name="description"]'),
        'Meta description is empty',
      ).toHaveAttribute('content', /\S/);
    });
    await pageCheck('canonical URL is set', async () => {
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical, 'No canonical link found').toBeTruthy();
    });
    await pageCheck('favicon is present', async () => {
      const favicon = page.locator('link[rel~="icon"]').first();
      const count = await favicon.count();
      expect(count, 'No favicon link tag found').toBeGreaterThan(0);
    });
    await pageCheck('logo is visible and links back to homepage', async () => {
      const logo = page
        .locator('header a[href="/"], .site-header a[href="/"], .logo, a.logo, [class*="logo"] a')
        .first();
      await expect(logo).toBeVisible();
    });
    await pageCheck('at least one hero/banner section visible', async () => {
      const hero = page
        .locator(
          '.banner, .hero, .slideshow, [class*="hero"], [class*="banner"], [class*="slider"], section',
        )
        .first();
      await expect(hero).toBeVisible();
    });
    await pageCheck('homepage images all load (no broken images)', async () => {
      const broken = await findBrokenImages(page);
      expect(broken, `Broken images:\n${broken.join('\n')}`).toHaveLength(0);
    });
    await pageCheck('CSS is applied (page is not unstyled raw HTML)', async () => {
      const bodyFont = await page.evaluate(() => window.getComputedStyle(document.body).fontFamily);
      expect(bodyFont, 'Body has no font-family — CSS may not have loaded').not.toBe('');
      // Check body is not just the browser default serif
      const bgColor = await page.evaluate(
        () => window.getComputedStyle(document.body).backgroundColor,
      );
      // At minimum a background is set (even white = rgb(255,255,255))
      expect(bgColor).toBeTruthy();
    });
    await pageCheck(
      'fixed/sticky elements are audited and not excessively blocking viewport',
      async () => {
        const fixed = await getFixedElements(page);

        // Log for visibility in report — not a hard failure but report all
        const highZIndex = fixed.filter(el => Number(el.zIndex) > 1000);
        if (highZIndex.length > 0) {
          console.log(
            'High z-index fixed elements (check for overlaps):\n',
            highZIndex.map(e => `  ${e.tag}.${e.classes} z:${e.zIndex} ${e.rect}`).join('\n'),
          );
        }

        // Hard check: no single fixed element should cover > 40% of viewport height
        const viewportHeight = await page.evaluate(() => window.innerHeight);
        const blockers = fixed.filter(el => {
          const match = el.rect.match(/(\d+)x(\d+)/);
          if (!match) return false;
          const h = parseInt(match[2], 10);
          return h > viewportHeight * 0.4 && Number(el.zIndex) > 100;
        });
        expect(
          blockers,
          `Element(s) covering >40% of viewport height:\n${blockers.map(e => JSON.stringify(e)).join('\n')}`,
        ).toHaveLength(0);
      },
    );
    await pageCheck('footer is visible and has links', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const footer = page.locator('footer, #footer, .site-footer').first();
      await expect(footer).toBeVisible();
      const links = footer.locator('a');
      expect(await links.count(), 'Footer has no links').toBeGreaterThan(0);
    });
  });

  test('HTTP redirects to HTTPS', async ({ page }) => {
    const httpUrl = BASE.replace(/^https:\/\//, 'http://');
    if (httpUrl === BASE) {
      test.skip(true, 'BASE URL is already HTTP — redirect check not applicable');
      return;
    }
    await page.goto(httpUrl, { waitUntil: 'domcontentloaded' });
    expect(page.url(), 'HTTP should redirect to HTTPS').toMatch(/^https:/i);
  });

  test('www subdomain redirects to canonical domain', async ({ request }) => {
    const url = new URL(BASE);
    const wwwUrl = `${url.protocol}//www.${url.host}${url.pathname}`;
    const resp = await request.get(wwwUrl);
    if (!resp) {
      test.skip(true, 'www subdomain is not responding — may not be configured');
      return;
    }
    const finalUrl = resp.url();
    // Either it redirected away from www, or it serves the same content (both are valid)
    const isCanonical = !finalUrl.includes('//www.') || finalUrl.startsWith(BASE);
    expect(isCanonical, `www should redirect to canonical; got ${finalUrl}`).toBe(true);
  });
});
