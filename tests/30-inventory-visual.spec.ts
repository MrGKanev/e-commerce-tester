import { createHash } from 'node:crypto';
import { test, expect } from './fixtures';
import { configuredPages, extraInventoryPages } from './inventory';
import { waitForVisualReady, clearCart, loadPageImages } from './helpers';
import { auditSpelling } from './spelling';
import { readSiteSettings } from '../config/site-settings';

for (const entry of configuredPages()) {
  test(
    `inventory snapshot — ${entry.type}: ${new URL(entry.url).pathname + new URL(entry.url).search}`,
    { tag: ['@full', '@visual'] },
    async ({ page }, testInfo) => {
      if (entry.type === 'cart') await clearCart(page);
      const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBeLessThan(400);
      await loadPageImages(page);
      await page.evaluate(() => scrollTo(0, 0));
      await waitForVisualReady(page);
      await auditSpelling(page, testInfo, entry.language);
      const file = createHash('sha256').update(entry.url).digest('hex').slice(0, 20);
      await expect(page).toHaveScreenshot(`${entry.type}-${file}.png`, {
        fullPage: true,
        animations: 'disabled',
        maxDiffPixelRatio: readSiteSettings().thresholds.visual.maxDiffPixelRatio,
        mask: [
          page.locator('[class*="chat"], [id*="chat"], [class*="countdown"], [data-cart-count]'),
        ],
      });
    },
  );
}

test(
  'inventory snapshots — discovered products',
  { tag: ['@full', '@visual'] },
  async ({ page }, testInfo) => {
    const discovered = extraInventoryPages();
    if (!discovered.length) {
      testInfo.annotations.push({
        type: 'not-applicable',
        description: 'No extra discovered product pages',
      });
      test.skip(true, 'No extra discovered product pages');
    }
    test.setTimeout(Math.max(120000, discovered.length * 60000));
    for (const entry of discovered)
      await test.step(entry.url, async () => {
        const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
        expect(response?.status()).toBeLessThan(400);
        await loadPageImages(page);
        await page.evaluate(() => scrollTo(0, 0));
        await waitForVisualReady(page);
        await auditSpelling(page, testInfo, entry.language);
        await expect(page).toHaveScreenshot(
          `discovered-${createHash('sha256').update(entry.url).digest('hex').slice(0, 20)}.png`,
          {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixelRatio: readSiteSettings().thresholds.visual.maxDiffPixelRatio,
          },
        );
      });
  },
);
