import { test, expect } from './fixtures';
import { configuredPages, extraInventoryPages } from './inventory';
import { auditCurrentPage } from './shared-page-audit';

for (const entry of configuredPages()) {
  test(
    `shared page — ${entry.type}: ${new URL(entry.url).pathname}${new URL(entry.url).search}`,
    { tag: '@pages' },
    async ({ page }, testInfo) => {
      const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), 'Page could not load').toBeLessThan(400);
      await auditCurrentPage(page, testInfo, entry.language);
    },
  );
}

test('shared pages — extra discovered products', { tag: '@pages' }, async ({ page }, testInfo) => {
  const entries = extraInventoryPages();
  if (!entries.length) {
    testInfo.annotations.push({ type: 'not-applicable', description: 'No extra discovered pages' });
    test.skip(true, 'No extra discovered pages');
  }
  test.setTimeout(Math.max(120000, entries.length * 60000));
  for (const entry of entries)
    await test.step(entry.url, async () => {
      const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBeLessThan(400);
      await auditCurrentPage(page, testInfo, entry.language);
    });
});
