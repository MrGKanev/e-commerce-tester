import type { TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import { readSiteSettings } from '../config/site-settings';
import { configuredPages, extraInventoryPages } from './inventory';
import { BASE, KNOWN_PRODUCT, MOBILE_MENU_TOGGLE_SEL, goto, waitForContent } from './helpers';
import { A11Y_CHECKS, auditA11yExtras, type A11yCheck } from './a11y-extras';
import { auditOverlay, auditVariantPicker, blockingAxe, type Audit } from './a11y-dynamic';

const settings = readSiteSettings();
const BUTTONS = ':is(button, summary, [role="button"])';
const OVERLAYS: Record<string, string> = {
  'mobile menu': MOBILE_MENU_TOGGLE_SEL,
  search: `header ${BUTTONS}[aria-label*="search" i], header ${BUTTONS}[aria-label*="търс" i]`,
  'cart drawer': `header ${BUTTONS}[aria-label*="cart" i], header ${BUTTONS}[aria-label*="количка" i]`,
};

function report(audit: Audit, info: TestInfo, name: string) {
  if (!audit.applicable) {
    info.annotations.push({ type: 'not-applicable', description: `No ${name} on this store` });
    test.skip(true, `No ${name} on this store`);
  }
  expect.soft(audit.problems, name).toEqual([]);
}

test.describe('40 · Accessibility of dynamic states', { tag: ['@full', '@a11y'] }, () => {
  for (const [name, selector] of Object.entries(OVERLAYS))
    test(`${name} opens, traps focus where modal, and closes with Escape`, async ({
      page,
    }, info) => {
      await goto(page);
      const trigger = page.locator(selector).filter({ visible: true }).first();
      if (!(await trigger.count())) {
        info.annotations.push({
          type: 'not-applicable',
          description: `No ${name} control at this viewport`,
        });
        test.skip(true, `No ${name} control at this viewport`);
      }
      report(await auditOverlay(page, trigger), info, name);
    });

  test('variant options are named, grouped and keyboard operable', async ({ page }, info) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
    await waitForContent(page);
    report(await auditVariantPicker(page), info, 'variant picker');
  });
});

// Pages that the configured inventory does not list. Optional ones are skipped when absent.
const OPTIONAL_PATHS =
  settings.platform === 'woocommerce'
    ? ['/my-account/']
    : [
        '/pages/contact',
        '/policies/privacy-policy',
        '/policies/refund-policy',
        '/policies/terms-of-service',
        '/policies/shipping-policy',
      ];
const known = new Set(configuredPages().map(entry => entry.url));
const beyond = [
  { url: BASE + '/a11y-page-that-does-not-exist', expect404: true },
  ...OPTIONAL_PATHS.map(path => ({ url: BASE + path, expect404: false })),
  ...extraInventoryPages().map(entry => ({ url: entry.url, expect404: false })),
].filter(entry => !known.has(entry.url));

for (const entry of beyond)
  test(
    `Accessibility beyond configured pages — ${new URL(entry.url).pathname}`,
    { tag: ['@full', '@a11y'] },
    async ({ page }, info) => {
      const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;
      if (!entry.expect404 && status >= 400) {
        info.annotations.push({
          type: 'not-applicable',
          description: `Optional page returned HTTP ${status}`,
        });
        test.skip(true, `Optional page returned HTTP ${status}`);
      }
      await waitForContent(page);
      const blocking = await blockingAxe(page);
      const problems = await auditA11yExtras(page, settings.locale);
      await info.attach('a11y-extras.json', {
        body: JSON.stringify({ url: entry.url, status, blocking, problems }),
        contentType: 'application/json',
      });
      expect.soft(blocking, 'WCAG 2.2 AA blockers').toEqual([]);
      for (const check of Object.keys(A11Y_CHECKS) as A11yCheck[])
        expect.soft(problems[check], A11Y_CHECKS[check]).toEqual([]);
    },
  );
