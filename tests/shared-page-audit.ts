import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { waitForContent, waitForImages } from './helpers';
import { auditSpelling } from './spelling';
import { readSiteSettings } from '../config/site-settings';

/** Read-only checks consume the current document. They never navigate or mutate cart. */
export async function auditCurrentPage(page: Page, testInfo: TestInfo, language: string) {
  await waitForContent(page);
  await test.step('Page metadata', async () => {
    await expect.soft(page, 'Page title is empty').not.toHaveTitle('');
    await expect.soft(page).not.toHaveTitle(/404|not found/i);
    const canonical = page.locator('link[rel="canonical"]').first();
    await expect.soft(canonical, 'Missing canonical URL').toHaveCount(1);
    if (await canonical.count()) {
      const href = await canonical.getAttribute('href');
      expect.soft(href, 'Canonical URL must be absolute').toMatch(/^https?:\/\//);
    }
  });
  await test.step('Viewport and visible media', async () => {
    await waitForImages(page);
    const broken = await page.locator('img:visible').evaluateAll(images =>
      images
        .filter(image => {
          const rect = image.getBoundingClientRect();
          return (
            rect.top < innerHeight &&
            rect.bottom > 0 &&
            (image as HTMLImageElement).complete &&
            (image as HTMLImageElement).naturalWidth === 0
          );
        })
        .map(image => (image as HTMLImageElement).src),
    );
    expect.soft(broken, 'Broken viewport images').toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 5,
    );
    expect.soft(overflow, 'Page overflows its viewport').toBe(false);
  });
  await test.step('WCAG 2.2 AA', async () => {
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .exclude('iframe')
      .analyze();
    await testInfo.attach('accessibility.json', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
    expect
      .soft(
        result.violations.filter(violation =>
          ['critical', 'serious'].includes(violation.impact || ''),
        ).length,
        'Accessibility blockers',
      )
      .toBeLessThanOrEqual(readSiteSettings().thresholds.accessibility.maxBlocking);
  });
  await test.step('Content spelling', async () => {
    await auditSpelling(page, testInfo, language);
  });
  await testInfo.attach('shared-page-evidence', {
    body: await page.screenshot({ animations: 'disabled', scale: 'css' }),
    contentType: 'image/png',
  });
}
