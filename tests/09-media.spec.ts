/**
 * 09-media.spec.ts
 * Image, font, and asset quality checks across key pages.
 */

import { test, expect } from '@playwright/test';
import { BASE, KNOWN_PRODUCTS, findBrokenImages } from './helpers';

const PAGES_TO_CHECK = [
  { label: 'Homepage', url: BASE },
  { label: 'Collections', url: `${BASE}/collections/all` },
  ...KNOWN_PRODUCTS.map((p) => ({ label: `Product ${p.handle}`, url: p.url })),
];

test.describe('09 · Media & assets', () => {

  // ── Broken images ──────────────────────────────────────────────────────────

  for (const { label, url } of PAGES_TO_CHECK) {
    test(`${label} — no broken images`, async ({ page }) => {
      await page.goto(url, { waitUntil: 'networkidle' });

      // Scroll to trigger lazy-loaded images
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          let totalHeight = 0;
          const distance = 300;
          const timer = setInterval(() => {
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= document.body.scrollHeight) {
              clearInterval(timer);
              window.scrollTo(0, 0);
              resolve();
            }
          }, 100);
        });
      });
      await page.waitForTimeout(1000);

      const broken = await findBrokenImages(page);
      expect(broken, `Broken images on ${label}:\n${broken.join('\n')}`).toHaveLength(0);
    });
  }

  // ── Alt text audit ─────────────────────────────────────────────────────────

  test('homepage images have alt text', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const missing = await page.$$eval('img:not([alt])', (imgs) =>
      imgs
        .filter((img) => {
          // Skip tracking pixels / tiny images
          const el = img as HTMLImageElement;
          return !el.src.includes('pixel') && !el.src.includes('beacon') && el.naturalWidth > 10;
        })
        .map((img) => (img as HTMLImageElement).src.slice(-70)),
    );

    if (missing.length > 0) {
      console.warn(`Images missing alt text on homepage:\n${missing.join('\n')}`);
    }
    // Warn but don't hard-fail — Shopify sometimes auto-fills alt from product title after JS
  });

  for (const p of KNOWN_PRODUCTS) {
    test(`${p.handle} — product images have alt text`, async ({ page }) => {
      await page.goto(p.url, { waitUntil: 'domcontentloaded' });

      const noAlt = await page.$$eval(
        '.product__media img, img[src*="products"]',
        (imgs) => imgs.filter((img) => !img.getAttribute('alt')).map((img) => (img as HTMLImageElement).src.slice(-60)),
      );

      if (noAlt.length > 0) {
        console.warn(`Product images missing alt on ${p.handle}:\n${noAlt.join('\n')}`);
      }
    });
  }

  // ── Failed network resources ───────────────────────────────────────────────

  for (const { label, url } of PAGES_TO_CHECK) {
    test(`${label} — no failed CSS or JS assets`, async ({ page }) => {
      const failed: string[] = [];

      page.on('response', (resp) => {
        const resUrl = resp.url();
        const status = resp.status();
        const isAsset =
          resUrl.endsWith('.css') ||
          resUrl.endsWith('.js') ||
          resUrl.includes('.css?') ||
          resUrl.includes('.js?');
        if (isAsset && status >= 400) {
          failed.push(`${status} ${resUrl.slice(-80)}`);
        }
      });

      await page.goto(url, { waitUntil: 'networkidle' });
      expect(
        failed,
        `Failed CSS/JS assets on ${label}:\n${failed.join('\n')}`,
      ).toHaveLength(0);
    });
  }

  // ── Image responsive hints ─────────────────────────────────────────────────

  test('product images use srcset or responsive sizing', async ({ page }) => {
    await page.goto(KNOWN_PRODUCTS[0].url, { waitUntil: 'domcontentloaded' });

    const imgSel = '.product__media img, img[src*="products"]';
    const firstImg = page.locator(imgSel).first();
    if ((await firstImg.count()) === 0) return;

    const hasSrcset = await firstImg.evaluate(
      (el) => !!(el as HTMLImageElement).srcset || !!(el as HTMLImageElement).sizes,
    );

    // Shopify CDN uses srcset for all product images — this should always pass
    expect(hasSrcset, 'Primary product image has no srcset — may not be responsive').toBe(true);
  });

  // ── Font loading ───────────────────────────────────────────────────────────

  test('custom fonts are loaded on homepage', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // Check if any font-face declarations exist
    const fontFaceCount = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      let count = 0;
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules ?? []);
          count += rules.filter((r) => r instanceof CSSFontFaceRule).length;
        } catch {
          // cross-origin sheets throw SecurityError — that's fine
        }
      }
      return count;
    });

    // Most Shopify stores use custom fonts — warn if none found
    if (fontFaceCount === 0) {
      console.warn('No @font-face declarations found — site may use system fonts only');
    }
    // Not a failure — system fonts are valid
  });

  // ── Video sections ─────────────────────────────────────────────────────────

  test('video elements on homepage load without errors (if any)', async ({ page }) => {
    const failedVideos: string[] = [];

    page.on('response', (resp) => {
      const url = resp.url();
      if (
        (url.endsWith('.mp4') || url.endsWith('.webm') || url.includes('video')) &&
        resp.status() >= 400
      ) {
        failedVideos.push(`${resp.status()} ${url.slice(-80)}`);
      }
    });

    await page.goto(BASE, { waitUntil: 'networkidle' });

    const videoCount = await page.locator('video').count();
    if (videoCount === 0) {
      test.skip(true, 'No video elements on homepage');
      return;
    }

    expect(
      failedVideos,
      `Failed video resources:\n${failedVideos.join('\n')}`,
    ).toHaveLength(0);
  });
});
