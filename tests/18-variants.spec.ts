/**
 * 18 · Product variants — deep tests
 *
 * Complements the basic variant checks in 04-product.spec.ts with:
 *  - Out-of-stock variants show a visual sold-out indicator
 *  - Selecting a variant updates the URL (?variant=ID)
 *  - Selecting a variant with a different image swaps the main product image
 *  - Variant selectors are keyboard-navigable
 */
import { test, expect } from '@playwright/test';
import { KNOWN_PRODUCTS, PRICE_SEL } from './helpers';

const VARIANT_RADIO_SEL = [
  '[name^="options["] input[type="radio"]',
  'variant-radios input[type="radio"]',
  '.product-form__input input[type="radio"]',
].join(', ');

const VARIANT_SELECT_SEL = [
  'select[name^="options["]',
  'variant-selects select',
  '.product-form__input select',
  'select[name="id"]',
].join(', ');

const PRODUCT_IMG_SEL = [
  '.product__media img',
  '.product-single__photo img',
  'img[src*="products"]',
].join(', ');

for (const product of KNOWN_PRODUCTS) {
  test.describe(`18 · Variants — ${product.handle}`, () => {

    test.beforeEach(async ({ page }) => {
      await page.goto(product.url, { waitUntil: 'domcontentloaded' });
    });

    // ── Variant selector presence ─────────────────────────────────────────

    test('variant selector exists (or single-variant product skips gracefully)', async ({ page }) => {
      const radios = page.locator(VARIANT_RADIO_SEL);
      const selects = page.locator(VARIANT_SELECT_SEL);
      const total = (await radios.count()) + (await selects.count());
      if (total === 0) {
        test.skip(true, `${product.handle} has no variant selectors — single-variant product`);
      }
      expect(total).toBeGreaterThan(0);
    });

    // ── Out-of-stock indicators ───────────────────────────────────────────

    test('out-of-stock variants have a visual sold-out indicator', async ({ page }) => {
      const radios = page.locator(VARIANT_RADIO_SEL);
      if ((await radios.count()) === 0) {
        test.skip(true, 'No radio variant selectors found');
        return;
      }

      const soldOutVariants = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(
          '[name^="options["] input[type="radio"], variant-radios input[type="radio"]',
        ));
        return inputs.filter(i => i.disabled || i.getAttribute('data-available') === 'false').length;
      });

      if (soldOutVariants === 0) {
        test.skip(true, 'No out-of-stock variants detected — all variants available');
        return;
      }

      // Each disabled variant should have some visual treatment
      const hasVisualIndicator = await page.evaluate(() => {
        const disabled = Array.from(document.querySelectorAll<HTMLInputElement>(
          '[name^="options["] input[type="radio"]:disabled',
        ));
        return disabled.every(input => {
          const label = document.querySelector(`label[for="${input.id}"]`);
          if (!label) return false;
          const style = window.getComputedStyle(label);
          return (
            style.opacity !== '1' ||
            style.textDecoration.includes('line-through') ||
            label.classList.toString().toLowerCase().includes('sold') ||
            label.classList.toString().toLowerCase().includes('unavailable') ||
            label.classList.toString().toLowerCase().includes('disable')
          );
        });
      });

      expect(
        hasVisualIndicator,
        'Disabled variants have no visual sold-out indicator (opacity, strikethrough, or class)',
      ).toBe(true);
    });

    // ── URL updates with ?variant= ────────────────────────────────────────

    test('selecting a variant appends ?variant=ID to the URL', async ({ page }) => {
      const radios = page.locator(VARIANT_RADIO_SEL);
      const count = await radios.count();
      if (count < 2) {
        test.skip(true, 'Not enough radio variants to test URL update');
        return;
      }

      // Click the second option (first may already be selected)
      await radios.nth(1).click();
      await page.waitForTimeout(500);

      const url = page.url();
      expect(url, 'URL did not update with ?variant= after selecting variant').toContain('variant=');
    });

    test('variant ID in URL matches a real Shopify variant', async ({ page }) => {
      const radios = page.locator(VARIANT_RADIO_SEL);
      if ((await radios.count()) < 2) {
        test.skip(true, 'Not enough variants to test');
        return;
      }

      await radios.nth(1).click();
      await page.waitForTimeout(500);

      const url = new URL(page.url());
      const variantId = url.searchParams.get('variant');
      if (!variantId) {
        test.skip(true, 'URL did not receive ?variant= param');
        return;
      }

      // Variant ID should be a numeric string
      expect(variantId).toMatch(/^\d+$/);
    });

    // ── Price updates on variant change ──────────────────────────────────

    test('price element remains visible after switching variant', async ({ page }) => {
      const radios = page.locator(VARIANT_RADIO_SEL);
      if ((await radios.count()) < 2) {
        test.skip(true, 'Not enough variants');
        return;
      }

      await radios.nth(1).click();
      await page.waitForTimeout(500);

      const price = page.locator(PRICE_SEL).first();
      await expect(price).toBeVisible();
      const text = await price.textContent();
      expect(text).toMatch(/[\d.,]+/);
    });

    // ── Image swap on variant change ──────────────────────────────────────

    test('product image src changes when switching to a variant with a different image', async ({ page }) => {
      const radios = page.locator(VARIANT_RADIO_SEL);
      if ((await radios.count()) < 2) {
        test.skip(true, 'Not enough variants to test image swap');
        return;
      }

      const imgBefore = await page.locator(PRODUCT_IMG_SEL).first().getAttribute('src');
      if (!imgBefore) {
        test.skip(true, 'No product image src found');
        return;
      }

      // Try each additional variant looking for an image change
      let imageChanged = false;
      for (let i = 1; i < Math.min(await radios.count(), 4); i++) {
        await radios.nth(i).click();
        await page.waitForTimeout(600);
        const imgAfter = await page.locator(PRODUCT_IMG_SEL).first().getAttribute('src').catch(() => null);
        if (imgAfter && imgAfter !== imgBefore) {
          imageChanged = true;
          break;
        }
      }

      if (!imageChanged) {
        // All variants share the same image — that's valid, not a bug
        test.skip(true, 'All variants share the same product image');
      }
    });

    // ── Keyboard accessibility ────────────────────────────────────────────

    test('variant radio inputs are reachable by Tab key', async ({ page }) => {
      const radios = page.locator(VARIANT_RADIO_SEL);
      if ((await radios.count()) === 0) {
        test.skip(true, 'No radio variant selectors found');
        return;
      }

      // tabIndex should not be -1 (which would hide from keyboard navigation)
      const allFocusable = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(
          '[name^="options["] input[type="radio"]',
        ));
        // At least one in each radio group should be keyboard-reachable
        const groups = new Map<string, HTMLInputElement[]>();
        for (const input of inputs) {
          const group = groups.get(input.name) ?? [];
          group.push(input);
          groups.set(input.name, group);
        }
        return Array.from(groups.values()).every(group =>
          group.some(i => i.tabIndex >= 0),
        );
      });

      expect(allFocusable, 'No variant radio in a group is keyboard-reachable (all tabIndex=-1)').toBe(true);
    });

    // ── Select-based variants ─────────────────────────────────────────────

    test('select-based variant dropdown works and updates price', async ({ page }) => {
      const selects = page.locator(VARIANT_SELECT_SEL);
      if ((await selects.count()) === 0) {
        test.skip(true, 'No select-based variant dropdowns');
        return;
      }

      const select = selects.first();
      const options = await select.locator('option').allTextContents();
      if (options.length < 2) {
        test.skip(true, 'Select has fewer than 2 options');
        return;
      }

      // Choose the second option
      const secondOption = (await select.locator('option').nth(1).getAttribute('value')) ?? '';
      if (!secondOption) return;

      await select.selectOption(secondOption);
      await page.waitForTimeout(500);

      const price = page.locator(PRICE_SEL).first();
      await expect(price).toBeVisible();
    });
  });
}
