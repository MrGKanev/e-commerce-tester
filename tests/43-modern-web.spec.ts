import { test, expect } from './fixtures';
import { configuredPages } from './inventory';
import { waitForContent } from './helpers';
import { inspectModernWeb, attachModernWeb } from './modern-web';

for (const entry of configuredPages())
  test(
    `modern web — ${entry.type}: ${new URL(entry.url).pathname}${new URL(entry.url).search}`,
    { tag: ['@full', '@modern-web'] },
    async ({ page }, testInfo) => {
      const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), 'Modern Web page must load').toBeLessThan(400);
      await waitForContent(page);
      const report = await inspectModernWeb(page);
      await attachModernWeb(report, testInfo);
      expect(
        report.findings.filter(finding => finding.severity === 'error'),
        'Broken form description references; see modern-web.txt for evidence and fixes',
      ).toEqual([]);
    },
  );
