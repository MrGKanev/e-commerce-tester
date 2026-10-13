import { test, expect } from './fixtures';
import { configuredPages } from './inventory';
import { waitForContent } from './helpers';
import { A11Y_CHECKS, auditA11yExtras, type A11yCheck } from './a11y-extras';

for (const entry of configuredPages()) {
  test(
    `Accessibility extras — ${entry.type}: ${new URL(entry.url).pathname}`,
    { tag: ['@full', '@a11y'] },
    async ({ page }, info) => {
      const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBeLessThan(400);
      await waitForContent(page);
      const problems = await auditA11yExtras(page, entry.language);
      await info.attach('a11y-extras.json', {
        body: JSON.stringify({ url: entry.url, problems }),
        contentType: 'application/json',
      });
      for (const check of Object.keys(A11Y_CHECKS) as A11yCheck[])
        expect.soft(problems[check], A11Y_CHECKS[check]).toEqual([]);
    },
  );
}
