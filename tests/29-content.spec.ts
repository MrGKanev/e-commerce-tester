import { test, expect } from './fixtures';
import { extraInventoryPages, configuredPages } from './inventory';
import { waitForContent } from './helpers';
import { auditSpelling } from './spelling';
import { readSiteSettings } from '../config/site-settings';

for (const entry of configuredPages()) {
  test(
    `content — ${entry.type}: ${new URL(entry.url).pathname + new URL(entry.url).search}`,
    { tag: ['@full', '@content'] },
    async ({ page }, testInfo) => {
      if (readSiteSettings().spelling.mode === 'off') {
        testInfo.annotations.push({
          type: 'not-applicable',
          description: 'Spelling disabled in site configuration',
        });
        test.skip(true, 'Spelling is disabled');
      }
      const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBeLessThan(400);
      await waitForContent(page);
      await auditSpelling(page, testInfo, entry.language);
    },
  );
}

test(
  'content — discovered inventory products',
  { tag: ['@full', '@content'] },
  async ({ page }, testInfo) => {
    const discovered = extraInventoryPages();
    if (!discovered.length || readSiteSettings().spelling.mode === 'off') {
      testInfo.annotations.push({
        type: 'not-applicable',
        description: 'No extra discovered content pages',
      });
      test.skip(true, 'No extra discovered content pages');
    }
    test.setTimeout(Math.max(120000, discovered.length * 60000));
    for (const entry of discovered)
      await test.step(entry.url, async () => {
        await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
        await waitForContent(page);
        await auditSpelling(page, testInfo, entry.language);
      });
  },
);
