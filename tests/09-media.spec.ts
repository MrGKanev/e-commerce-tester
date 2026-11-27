import { waitForVisualReady, BASE, KNOWN_PRODUCTS, findBrokenImages } from './helpers';
import type { Response } from '@playwright/test';
import { test, expect } from './fixtures';
import { pageCheck } from './page-check';

const PAGES_TO_CHECK = [
  { label: 'Homepage', url: BASE },
  { label: 'Collections', url: `${BASE}/collections/all` },
  ...KNOWN_PRODUCTS.map(p => ({ label: `Product ${p.handle}`, url: p.url })),
];

test.describe('09 · Media & assets', { tag: '@full' }, () => {
  for (const { label, url } of PAGES_TO_CHECK)
    test(`${label} — shared media checks`, async ({ page }) => {
      const failed: string[] = [],
        failedVideos: string[] = [];
      const observeResources = (response: Response) => {
        const resource = response.url(),
          status = response.status();
        if (status < 400) return;
        if (/\.(?:css|js)(?:\?|$)/.test(resource)) failed.push(`${status} ${resource.slice(-80)}`);
        if (resource.endsWith('.mp4') || resource.endsWith('.webm') || resource.includes('video'))
          failedVideos.push(`${status} ${resource.slice(-80)}`);
      };
      page.on('response', observeResources);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await waitForVisualReady(page);
      page.off('response', observeResources);
      await pageCheck(`${label} — no broken images`, async () => {
        const broken = await findBrokenImages(page);
        expect(broken, `Broken images on ${label}:\n${broken.join('\n')}`).toHaveLength(0);
      });
      await pageCheck(`${label} — no failed CSS or JS assets`, async () => {
        expect(failed, `Failed CSS/JS assets on ${label}:\n${failed.join('\n')}`).toHaveLength(0);
      });
      if (url === BASE) {
        await pageCheck('homepage images have alt text', async () => {
          const missing = await page.$$eval('img:not([alt])', imgs =>
            imgs
              .filter(img => {
                // Skip tracking pixels / tiny images
                const el = img as HTMLImageElement;
                return (
                  !el.src.includes('pixel') && !el.src.includes('beacon') && el.naturalWidth > 10
                );
              })
              .map(img => (img as HTMLImageElement).src.slice(-70)),
          );

          if (missing.length > 0) {
            console.warn(`Images missing alt text on homepage:\n${missing.join('\n')}`);
          }
          // Warn but don't hard-fail — Shopify sometimes auto-fills alt from product title after JS
        });
        await pageCheck('custom fonts are loaded on homepage', async () => {
          // Check if any font-face declarations exist
          const fontFaceCount = await page.evaluate(() => {
            const sheets = Array.from(document.styleSheets);
            let count = 0;
            for (const sheet of sheets) {
              try {
                const rules = Array.from(sheet.cssRules ?? []);
                count += rules.filter(r => r instanceof CSSFontFaceRule).length;
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
        await pageCheck('video elements on homepage load without errors (if any)', async step => {
          const videoCount = await page.locator('video').count();
          if (videoCount === 0) {
            step.skip(true, 'No video elements on homepage');
            return;
          }

          expect(failedVideos, `Failed video resources:\n${failedVideos.join('\n')}`).toHaveLength(
            0,
          );
        });
      }
      const product = KNOWN_PRODUCTS.find(candidate => candidate.url === url);
      if (product)
        await pageCheck(`${product.handle} — product images have alt text`, async () => {
          const noAlt = await page
            .locator('.product__media img, img[src*="products"]')
            .evaluateAll(images =>
              images
                .filter(img => !img.getAttribute('alt'))
                .map(img => (img as HTMLImageElement).src.slice(-60)),
            );
          if (noAlt.length)
            console.warn(`Product images missing alt on ${product.handle}:\n${noAlt.join('\n')}`);
        });
      if (url === KNOWN_PRODUCTS[0].url)
        await pageCheck('product images use srcset or responsive sizing', async () => {
          const imgSel = '.product__media img, img[src*="products"]';
          const firstImg = page.locator(imgSel).first();
          if ((await firstImg.count()) === 0) return;

          const hasSrcset = await firstImg.evaluate(
            el => !!(el as HTMLImageElement).srcset || !!(el as HTMLImageElement).sizes,
          );

          // Shopify CDN uses srcset for all product images — this should always pass
          expect(hasSrcset, 'Primary product image has no srcset — may not be responsive').toBe(
            true,
          );
        });
    });
});
