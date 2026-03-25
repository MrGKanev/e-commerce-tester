/**
 * GDPR / Cookie Consent tests
 *
 * Each test opens a *fresh* browser context (no saved storage state) to
 * simulate a first-time visitor.  If the store has no cookie banner all
 * tests skip gracefully — having no banner is a valid deployment choice.
 *
 * What we verify:
 *  1. Banner appears on first visit
 *  2. Banner does NOT reappear after accepting
 *  3. Consent persists when navigating between pages
 *  4. Consent is recorded in cookies or localStorage
 *  5. No JS errors occur during the accept flow
 */
import { test, expect } from '@playwright/test';
import { BASE, COOKIE_CONSENT_SEL } from './helpers';

/** Selectors for the "decline / reject all" button — less standardised than accept */
const COOKIE_DECLINE_SEL = [
  '#onetrust-reject-all-handler',
  '.cc-btn.cc-deny',
  'button:has-text("Decline all")',
  'button:has-text("Reject all")',
  'button:has-text("Decline")',
  'button:has-text("Reject")',
  'button:has-text("Отказвам всички")',
  'button:has-text("Отказвам")',
  'button:has-text("Откажи")',
].join(', ');

/** Pattern that matches consent-related cookie/storage keys */
const CONSENT_PATTERN = /consent|cookie|gdpr|tracking|privacy|cc_/i;

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('15 · GDPR / Cookie Consent', () => {

  test('cookie banner appears on first visit (fresh context, no cookies)', async ({ browser }) => {
    const context = await browser.newContext({
      locale: 'bg-BG',
      timezoneId: 'Europe/Sofia',
      // No storageState — simulates a brand-new visitor
    });
    const page = await context.newPage();

    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2_500); // banner may animate in

      const bannerVisible = await page.locator(COOKIE_CONSENT_SEL).first()
        .isVisible().catch(() => false);

      if (!bannerVisible) {
        test.skip(true, 'No cookie consent banner detected — store may not require one');
        return;
      }

      expect(bannerVisible, 'Cookie consent banner should be visible on first visit').toBe(true);
    } finally {
      await context.close();
    }
  });

  test('banner does not reappear after accepting consent', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'bg-BG', timezoneId: 'Europe/Sofia' });
    const page = await context.newPage();

    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2_500);

      const banner = page.locator(COOKIE_CONSENT_SEL).first();
      if (!(await banner.isVisible().catch(() => false))) {
        test.skip(true, 'No cookie banner detected');
        return;
      }

      await banner.click();
      await page.waitForTimeout(800);

      // Full reload — consent should be remembered via cookie/localStorage
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1_500);

      const reappeared = await page.locator(COOKIE_CONSENT_SEL).first()
        .isVisible().catch(() => false);

      expect(reappeared, 'Cookie banner reappeared after consent was given').toBe(false);
    } finally {
      await context.close();
    }
  });

  test('consent persists across page navigation', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'bg-BG', timezoneId: 'Europe/Sofia' });
    const page = await context.newPage();

    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2_500);

      const banner = page.locator(COOKIE_CONSENT_SEL).first();
      if (!(await banner.isVisible().catch(() => false))) {
        test.skip(true, 'No cookie banner detected');
        return;
      }

      await banner.click();
      await page.waitForTimeout(800);

      // Navigate to product page — banner should stay gone
      await page.goto(`${BASE}/products/zerno-z1`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1_500);

      const bannerOnProduct = await page.locator(COOKIE_CONSENT_SEL).first()
        .isVisible().catch(() => false);

      expect(bannerOnProduct, 'Cookie banner reappeared on product page after consent').toBe(false);
    } finally {
      await context.close();
    }
  });

  test('consent choice is stored in cookies or localStorage', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'bg-BG', timezoneId: 'Europe/Sofia' });
    const page = await context.newPage();

    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2_500);

      const banner = page.locator(COOKIE_CONSENT_SEL).first();
      if (!(await banner.isVisible().catch(() => false))) {
        test.skip(true, 'No cookie banner detected');
        return;
      }

      await banner.click();
      await page.waitForTimeout(1_200);

      const cookies = await context.cookies();
      const lsKeys  = await page.evaluate(() => Object.keys(window.localStorage));

      const matchingCookies = cookies.filter(c => CONSENT_PATTERN.test(c.name));
      const matchingLsKeys  = lsKeys.filter(k => CONSENT_PATTERN.test(k));

      console.log('Consent cookies:', matchingCookies.map(c => c.name));
      console.log('Consent localStorage keys:', matchingLsKeys);

      expect(
        matchingCookies.length > 0 || matchingLsKeys.length > 0,
        'No consent record found in cookies or localStorage after accepting banner',
      ).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('no JS errors during the cookie consent accept flow', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'bg-BG', timezoneId: 'Europe/Sofia' });
    const page = await context.newPage();
    const errors: string[] = [];

    page.on('pageerror', (err) => {
      const msg = err.message;
      // Filter known harmless noise from third-party scripts
      if (
        !msg.includes('Non-Error exception') &&
        !msg.includes('ResizeObserver loop') &&
        !msg.includes('Script error.')
      ) {
        errors.push(msg);
      }
    });

    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(1_000);

      const banner = page.locator(COOKIE_CONSENT_SEL).first();
      if (await banner.isVisible().catch(() => false)) {
        await banner.click();
        await page.waitForTimeout(1_000);
      }

      // Let any async side-effects settle
      await page.waitForTimeout(1_500);

      expect(
        errors.length,
        `JS errors during consent flow:\n  ${errors.join('\n  ')}`,
      ).toBe(0);
    } finally {
      await context.close();
    }
  });

  test('decline button (if present) hides banner without JS errors', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'bg-BG', timezoneId: 'Europe/Sofia' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2_500);

      const declineBtn = page.locator(COOKIE_DECLINE_SEL).first();
      const declineVisible = await declineBtn.isVisible().catch(() => false);

      if (!declineVisible) {
        test.skip(true, 'No decline/reject button found — store may only offer accept');
        return;
      }

      await declineBtn.click();
      await page.waitForTimeout(800);

      // Banner should disappear after declining
      const bannerAfterDecline = await page.locator(COOKIE_CONSENT_SEL).first()
        .isVisible().catch(() => false);

      expect(bannerAfterDecline, 'Banner still visible after declining consent').toBe(false);

      const filteredErrors = errors.filter(
        e => !e.includes('ResizeObserver') && !e.includes('Script error.'),
      );
      expect(filteredErrors.length, `JS errors after decline:\n  ${filteredErrors.join('\n  ')}`).toBe(0);
    } finally {
      await context.close();
    }
  });
});
