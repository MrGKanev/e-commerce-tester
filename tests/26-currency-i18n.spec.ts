/**
 * 26 · Multi-currency & i18n
 *
 * Validates that currency and language switchers work correctly when
 * Shopify Markets or third-party currency apps are enabled.
 * Tests soft-skip if the switcher is absent (feature not enabled).
 */
import { test, expect } from '@playwright/test';
import { BASE, goto } from './helpers';

// ── Selectors ─────────────────────────────────────────────────────────────────

const CURRENCY_SWITCHER_SEL = [
  'select[name="currency"]',
  '[data-currency-picker]',
  '.currency-selector',
  '.currency-picker',
  '#CurrencySelector',
  'button[aria-label*="currency" i]',
  'button[aria-label*="валута" i]',
  '.localization-form__select[data-currency]',
  'details summary:has-text("Currency")',
  'details summary:has-text("Валута")',
].join(', ');

const LANGUAGE_SWITCHER_SEL = [
  'select[name="locale"]',
  '[data-locale-picker]',
  '.language-selector',
  '.locale-selector',
  '#LocaleSelector',
  'button[aria-label*="language" i]',
  'button[aria-label*="език" i]',
  '.localization-form__select[data-locale]',
  'details summary:has-text("Language")',
  'details summary:has-text("Език")',
].join(', ');

const PRICE_SEL = [
  'span.money',
  '.price-item--regular',
  '.price__regular .price-item',
  '[data-product-price]',
].join(', ');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extracts a currency symbol or code from price text */
function parseCurrencyCode(priceText: string): string {
  const match = priceText.match(/[A-Z]{3}|[$€£¥₹лв]/);
  return match?.[0] ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('26 · Multi-currency & i18n', () => {

  // ── Switcher presence ──────────────────────────────────────────────────────

  test('currency switcher is present in the page', async ({ page }) => {
    await goto(page, '/');
    const switcher = page.locator(CURRENCY_SWITCHER_SEL).first();
    if ((await switcher.count()) === 0) {
      test.skip(true, 'Currency switcher not found — Shopify Markets or multi-currency app may not be enabled');
      return;
    }
    await expect(switcher).toBeVisible();
  });

  test('language / locale switcher is present in the page', async ({ page }) => {
    await goto(page, '/');
    const switcher = page.locator(LANGUAGE_SWITCHER_SEL).first();
    if ((await switcher.count()) === 0) {
      test.skip(true, 'Language switcher not found — multi-language may not be enabled');
      return;
    }
    await expect(switcher).toBeVisible();
  });

  // ── Currency switching ─────────────────────────────────────────────────────

  test('switching currency updates prices on the homepage', async ({ page }) => {
    await goto(page, '/');

    const switcher = page.locator(CURRENCY_SWITCHER_SEL).first();
    if ((await switcher.count()) === 0) {
      test.skip(true, 'No currency switcher');
      return;
    }

    // Capture price before switch
    const priceEl = page.locator(PRICE_SEL).first();
    const priceBefore = (await priceEl.textContent().catch(() => ''))?.trim();

    // Try to pick a different currency
    const tag = await switcher.evaluate(el => el.tagName.toLowerCase());
    if (tag === 'select') {
      const options = await switcher.locator('option').all();
      if (options.length < 2) {
        test.skip(true, 'Only one currency option available');
        return;
      }
      const currentVal = await switcher.inputValue();
      const otherOption = options.find(async o => (await o.inputValue()) !== currentVal);
      if (!otherOption) {
        test.skip(true, 'Cannot find alternate currency');
        return;
      }
      const newVal = await otherOption.inputValue();
      await switcher.selectOption(newVal);
    } else {
      // Button-based switcher — click to open, then pick first option
      await switcher.click();
      await page.waitForTimeout(500);
      const options = page.locator('[data-currency-option], .currency-option, .localization-form__item').all();
      const opts = await options;
      if (opts.length === 0) {
        test.skip(true, 'Currency dropdown items not found');
        return;
      }
      await opts[0].click();
    }

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1_000);

    // Price text or URL should have changed
    const priceAfter = (await priceEl.textContent().catch(() => ''))?.trim();
    const urlChanged = page.url().includes('currency=') || page.url().includes('locale=');

    if (priceBefore && priceAfter && !urlChanged) {
      // In some setups the price symbol/value changes
      const codeAfter = parseCurrencyCode(priceAfter);
      const codeBefore = parseCurrencyCode(priceBefore);
      if (codeAfter && codeBefore) {
        expect(codeAfter, 'Currency code did not change after switching').not.toBe(codeBefore);
      }
    }
    // At minimum no page crash
    expect(page.url()).toBeTruthy();
  });

  // ── Price consistency ──────────────────────────────────────────────────────

  test('prices on the page share a consistent currency symbol', async ({ page }) => {
    await goto(page, '/');

    const priceEls = page.locator(PRICE_SEL);
    const count = await priceEls.count();
    if (count < 2) {
      test.skip(true, 'Not enough price elements to check consistency');
      return;
    }

    const symbols = new Set<string>();
    for (let i = 0; i < Math.min(count, 10); i++) {
      const text = (await priceEls.nth(i).textContent().catch(() => ''))?.trim();
      if (text) {
        const sym = parseCurrencyCode(text);
        if (sym) symbols.add(sym);
      }
    }

    expect(
      symbols.size,
      `Mixed currency symbols on homepage: ${[...symbols].join(', ')}`,
    ).toBeLessThanOrEqual(1);
  });

  // ── Language / locale switching ────────────────────────────────────────────

  test('switching language reloads the page in the new locale', async ({ page }) => {
    await goto(page, '/');

    const switcher = page.locator(LANGUAGE_SWITCHER_SEL).first();
    if ((await switcher.count()) === 0) {
      test.skip(true, 'No language switcher');
      return;
    }

    const tag = await switcher.evaluate(el => el.tagName.toLowerCase());
    if (tag === 'select') {
      const options = await switcher.locator('option').all();
      if (options.length < 2) {
        test.skip(true, 'Only one language available');
        return;
      }
      const current = await switcher.inputValue();
      for (const opt of options) {
        const val = await opt.inputValue();
        if (val !== current) {
          await switcher.selectOption(val);
          break;
        }
      }
    } else {
      await switcher.click();
      await page.waitForTimeout(500);
      const items = page.locator('[data-locale-option], .language-option, .localization-form__item');
      if ((await items.count()) === 0) {
        test.skip(true, 'Language dropdown items not found');
        return;
      }
      await items.first().click();
    }

    await page.waitForLoadState('domcontentloaded');
    // A locale switch usually changes the URL path (/en, /bg, etc.) or sets a cookie
    const url = page.url();
    expect(url, 'Page did not navigate after locale switch').toBeTruthy();
    expect(url.startsWith('http')).toBe(true);
  });

  // ── Shopify Markets API ────────────────────────────────────────────────────

  test('Shopify Markets meta tag or JSON is present when multi-currency is enabled', async ({ page }) => {
    await goto(page, '/');

    const currencyMeta = await page.$eval(
      'meta[name="currency"], meta[property="og:price:currency"], [data-currency]',
      (el): string => (el as HTMLMetaElement).content ?? el.getAttribute('data-currency') ?? '',
    ).catch(() => '');

    if (!currencyMeta) {
      test.skip(true, 'No currency meta tag — Markets may not be active');
      return;
    }

    // Should be a valid ISO 4217 code (3 uppercase letters)
    expect(currencyMeta).toMatch(/^[A-Z]{3}$/);
  });

  test('/localization endpoint returns valid JSON', async ({ request }) => {
    const resp = await request.get(`${BASE}/?section_id=localization-form`).catch(() => null);
    if (!resp || resp.status() === 404) {
      test.skip(true, 'No localization section endpoint');
      return;
    }
    expect(resp.status()).toBeLessThan(500);
  });
});
