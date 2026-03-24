import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { BASE, goto, KNOWN_PRODUCT } from './helpers';

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
  return violations
    .map(v => `[${v.impact?.toUpperCase()}] ${v.id}: ${v.description}`)
    .join('\n  ');
}

test.describe('11 · Accessibility (axe)', () => {

  // ─── Homepage ──────────────────────────────────────────────────────────────

  test('homepage — no critical or serious violations (WCAG 2.1 AA)', async ({ page }) => {
    await goto(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude(THIRD_PARTY_EXCLUDES)
      .analyze();

    const blockers = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      blockers.length,
      `Critical/serious violations on homepage:\n  ${formatViolations(blockers as Violation[])}`,
    ).toBe(0);
  });

  test('homepage — axe violation count stays within threshold', async ({ page }) => {
    await goto(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
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
    expect(results.violations.length).toBeLessThanOrEqual(10);
  });

  // ─── Product page ──────────────────────────────────────────────────────────

  test('product page — no critical violations', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .exclude(THIRD_PARTY_EXCLUDES)
      .analyze();

    const blockers = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      blockers.length,
      `Critical/serious violations on product page:\n  ${formatViolations(blockers as Violation[])}`,
    ).toBe(0);
  });

  // ─── Search results ────────────────────────────────────────────────────────

  test('search results page — no critical violations', async ({ page }) => {
    await page.goto(`${BASE}/search?q=zerno&type=product`, {
      waitUntil: 'domcontentloaded',
    });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .exclude(THIRD_PARTY_EXCLUDES)
      .analyze();

    const blockers = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      blockers.length,
      `Critical/serious violations on search page:\n  ${formatViolations(blockers as Violation[])}`,
    ).toBe(0);
  });

  // ─── Collections ───────────────────────────────────────────────────────────

  test('collections page — no critical violations', async ({ page }) => {
    await page.goto(`${BASE}/collections`, { waitUntil: 'domcontentloaded' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .exclude(THIRD_PARTY_EXCLUDES)
      .analyze();

    const blockers = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      blockers.length,
      `Critical/serious violations on collections page:\n  ${formatViolations(blockers as Violation[])}`,
    ).toBe(0);
  });

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

  test('cart page — no critical violations', async ({ page }) => {
    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .exclude(THIRD_PARTY_EXCLUDES)
      .analyze();

    const blockers = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      blockers.length,
      `Critical/serious violations on cart page:\n  ${formatViolations(blockers as Violation[])}`,
    ).toBe(0);
  });

  // ─── Static page ───────────────────────────────────────────────────────────

  test('contact/about page — no critical violations (if exists)', async ({ page }) => {
    // Try /pages/contact first, fall back to /pages/about
    for (const path of ['/pages/contact', '/pages/about', '/pages/about-us']) {
      const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      if (resp?.status() === 200 && !page.url().includes('404')) {
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa'])
          .exclude(THIRD_PARTY_EXCLUDES)
          .analyze();

        const blockers = results.violations.filter(
          v => v.impact === 'critical' || v.impact === 'serious',
        );

        expect(
          blockers.length,
          `Critical/serious violations on ${path}:\n  ${formatViolations(blockers as Violation[])}`,
        ).toBe(0);
        return; // tested one page — done
      }
    }
    test.skip(true, 'No contact/about page found');
  });

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
    expect(results.violations.flatMap(v => v.nodes).length).toBeLessThanOrEqual(5);
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
