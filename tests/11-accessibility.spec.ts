import { configuredPages, extraInventoryPages } from './inventory';
import { readSiteSettings } from '../config/site-settings';
import { waitForContent } from './helpers';
const settings = readSiteSettings();
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { BASE, SEARCH_TERM, goto, KNOWN_PRODUCT } from './helpers';

// Exclude third-party widgets that we cannot fix (chat, consent banners, etc.)
const THIRD_PARTY_EXCLUDES = [
  '[class*="chat"]',
  '[id*="chat"]',
  '[class*="cookie"]',
  '[id*="cookie"]',
  '[id*="onetrust"]',
  'iframe',
];

type Violation = {
  id: string;
  impact: string | null;
  description: string;
  nodes: { html: string }[];
};

/** Format violations for readable test output */
function formatViolations(violations: Violation[]): string {
  return violations.map(v => `[${v.impact?.toUpperCase()}] ${v.id}: ${v.description}`).join('\n  ');
}

test.describe('11 · Accessibility (axe)', { tag: ['@full'] }, () => {
  // ─── Homepage ──────────────────────────────────────────────────────────────

  test('homepage — axe violation count stays within threshold', async ({ page }) => {
    await goto(page);

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .exclude(THIRD_PARTY_EXCLUDES)
      .analyze();

    // Log all violations for transparency even when passing
    if (results.violations.length > 0) {
      console.log(
        `Axe found ${results.violations.length} violation(s) on homepage:\n  ` +
          formatViolations(results.violations as Violation[]),
      );
    }

    // No more than 10 total (minor/moderate included) — acts as a ratchet
    expect(results.violations.length).toBeLessThanOrEqual(
      settings.thresholds.accessibility.maxViolations,
    );
  });

  // ─── Product page ──────────────────────────────────────────────────────────

  // ─── Search results ────────────────────────────────────────────────────────

  // ─── Collections ───────────────────────────────────────────────────────────

  test('collections page — product cards have accessible names', async ({ page }) => {
    await page.goto(`${BASE}/collections`, { waitUntil: 'domcontentloaded' });

    const results = await new AxeBuilder({ page })
      .withRules(['link-name', 'image-alt'])
      .exclude(THIRD_PARTY_EXCLUDES)
      .analyze();

    expect(
      results.violations.length,
      `Product card links/images without accessible names:\n  ${formatViolations(results.violations as Violation[])}`,
    ).toBe(0);
  });

  // ─── Cart ──────────────────────────────────────────────────────────────────

  // ─── Static page ───────────────────────────────────────────────────────────

  // ─── Specific checks ───────────────────────────────────────────────────────

  test('homepage — all images have alt text', async ({ page }) => {
    await goto(page);

    const results = await new AxeBuilder({ page })
      .withRules(['image-alt'])
      .exclude(THIRD_PARTY_EXCLUDES)
      .analyze();

    expect(
      results.violations.length,
      `Images missing alt text:\n  ${results.violations.flatMap(v => v.nodes.map((n: { html: string }) => n.html)).join('\n  ')}`,
    ).toBe(0);
  });

  test('homepage — interactive elements have accessible names', async ({ page }) => {
    await goto(page);

    const results = await new AxeBuilder({ page })
      .withRules(['button-name', 'link-name', 'input-button-name'])
      .exclude(THIRD_PARTY_EXCLUDES)
      .analyze();

    expect(
      results.violations.length,
      `Interactive elements without accessible names:\n  ${formatViolations(results.violations as Violation[])}`,
    ).toBe(0);
  });

  test('homepage — page has proper heading hierarchy', async ({ page }) => {
    await goto(page);

    const results = await new AxeBuilder({ page })
      .withRules(['heading-order', 'page-has-heading-one'])
      .exclude(THIRD_PARTY_EXCLUDES)
      .analyze();

    if (results.violations.length > 0) {
      console.log('Heading issues:', formatViolations(results.violations as Violation[]));
    }

    // Heading order is a best-practice, not a blocker — warn but don't fail
    const criticalHeadingIssues = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(criticalHeadingIssues.length).toBe(0);
  });

  test('homepage — color contrast meets WCAG AA', async ({ page }) => {
    await goto(page);

    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .exclude(THIRD_PARTY_EXCLUDES)
      .analyze();

    if (results.violations.length > 0) {
      console.log(
        `Color contrast issues (${results.violations[0]?.nodes?.length ?? 0} elements):`,
        formatViolations(results.violations as Violation[]),
      );
    }

    // Contrast is often a design decision — log but allow up to 5 instances
    expect(results.violations.flatMap(v => v.nodes).length).toBeLessThanOrEqual(
      settings.thresholds.accessibility.maxContrastNodes,
    );
  });

  test('product page — form controls are properly labelled', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });

    const results = await new AxeBuilder({ page })
      .withRules(['label', 'select-name'])
      .exclude(THIRD_PARTY_EXCLUDES)
      .analyze();

    expect(
      results.violations.length,
      `Form controls without labels:\n  ${formatViolations(results.violations as Violation[])}`,
    ).toBe(0);
  });
});

for (const entry of configuredPages()) {
  test(
    `WCAG 2.2 AA — ${entry.type}: ${new URL(entry.url).pathname + new URL(entry.url).search}`,
    { tag: '@full' },
    async ({ page }, testInfo) => {
      const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBeLessThan(400);
      await waitForContent(page);
      let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
      for (const selector of THIRD_PARTY_EXCLUDES) builder = builder.exclude(selector);
      const result = await builder.analyze();
      await testInfo.attach('accessibility.json', {
        body: JSON.stringify(result),
        contentType: 'application/json',
      });
      if (result.violations.some(v => v.impact === 'critical' || v.impact === 'serious'))
        testInfo.annotations.push({ type: 'failure-url', description: entry.url });
      expect(
        result.violations.filter(v => v.impact === 'critical' || v.impact === 'serious').length,
      ).toBeLessThanOrEqual(settings.thresholds.accessibility.maxBlocking);
    },
  );
}

test(
  'WCAG 2.2 AA — discovered inventory products',
  { tag: '@full' },
  async ({ page }, testInfo) => {
    const discovered = extraInventoryPages();
    if (!discovered.length) {
      testInfo.annotations.push({
        type: 'not-applicable',
        description: 'No additional discovered products',
      });
      test.skip(true, 'No additional discovered products');
    }
    test.setTimeout(Math.max(120000, discovered.length * 60000));
    for (const entry of discovered)
      await test.step(entry.url, async () => {
        await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
        await waitForContent(page);
        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        await testInfo.attach('accessibility.json', {
          body: JSON.stringify(results),
          contentType: 'application/json',
        });
        if (results.violations.some(v => v.impact === 'critical' || v.impact === 'serious'))
          testInfo.annotations.push({ type: 'failure-url', description: entry.url });
        expect(
          results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious').length,
        ).toBeLessThanOrEqual(settings.thresholds.accessibility.maxBlocking);
      });
  },
);
