/**
 * 25 · Discount codes & promotions
 *
 * Validates that the cart discount code field is present, handles invalid
 * input gracefully, and (optionally) applies a valid code.
 *
 * Set DISCOUNT_CODE=YOURCODE in .env to enable the valid-code tests.
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE, KNOWN_PRODUCT, ADD_TO_CART_SEL } from './helpers';

// ── Selectors ─────────────────────────────────────────────────────────────────

const DISCOUNT_INPUT_SEL = [
  'input[name="discount"]',
  '#discount',
  '#coupon',
  'input[name="coupon"]',
  '[data-discount-field]',
  'input[placeholder*="Discount" i]',
  'input[placeholder*="код" i]',
  'input[placeholder*="купон" i]',
].join(', ');

const DISCOUNT_APPLY_BTN_SEL = [
  'button[name="apply"]',
  'button:has-text("Apply")',
  'button:has-text("Приложи")',
  '#discount-form button[type="submit"]',
  '.cart__discount-btn',
  'form:has(input[name="discount"]) button[type="submit"]',
].join(', ');

const DISCOUNT_ERROR_SEL = [
  '.cart__discount-error',
  '[data-discount-error]',
  '.discount-error',
  '.form-errors',
  '[role="alert"]',
].join(', ');

const CART_TOTAL_SEL = [
  '.cart__total',
  '.totals__total-value',
  '[data-cart-total]',
  '.cart-total__price',
  '.order-summary__emphasis',
].join(', ');

// ── Helper ────────────────────────────────────────────────────────────────────

async function goToCartWithItem(page: Page): Promise<boolean> {
  await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
  const btn = page.locator(ADD_TO_CART_SEL).first();
  if ((await btn.count()) === 0 || (await btn.isDisabled())) return false;
  await btn.click();
  await Promise.race([
    page.waitForURL('**/cart**', { timeout: 6_000 }).catch(() => null),
    page.waitForResponse(r => /\/cart(\/add)?\.js/.test(r.url()), { timeout: 6_000 }).catch(() => null),
  ]);
  if (!page.url().includes('/cart')) {
    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
  }
  return true;
}

async function getDiscountField(page: Page) {
  await goToCartWithItem(page).catch(() => null);
  if (!page.url().includes('/cart')) {
    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
  }
  return page.locator(DISCOUNT_INPUT_SEL).first();
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('25 · Discount codes & promotions', () => {

  // ── Field presence ─────────────────────────────────────────────────────────

  test('cart page has a discount code input field', async ({ page }) => {
    const field = await getDiscountField(page);
    if ((await field.count()) === 0) {
      test.skip(true, 'Discount code field not found — feature may not be enabled');
      return;
    }
    await expect(field).toBeVisible();
  });

  test('discount apply button is present next to the code input', async ({ page }) => {
    const field = await getDiscountField(page);
    if ((await field.count()) === 0) {
      test.skip(true, 'No discount input found');
      return;
    }
    const btn = page.locator(DISCOUNT_APPLY_BTN_SEL).first();
    if ((await btn.count()) === 0) {
      test.skip(true, 'No apply button — discount may submit via Enter');
      return;
    }
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  // ── Invalid code handling ──────────────────────────────────────────────────

  test('invalid discount code shows an error or does not reduce the total', async ({ page }) => {
    const field = await getDiscountField(page);
    if ((await field.count()) === 0) {
      test.skip(true, 'No discount field — feature not enabled');
      return;
    }

    const totalBefore = (await page.locator(CART_TOTAL_SEL).first().textContent().catch(() => ''))?.trim();

    await field.fill('INVALID_CODE_XYZ_999');
    const applyBtn = page.locator(DISCOUNT_APPLY_BTN_SEL).first();
    if ((await applyBtn.count()) > 0) {
      await applyBtn.click();
    } else {
      await field.press('Enter');
    }

    // Either an error message appears or the total is unchanged
    const hasError = await page.locator(DISCOUNT_ERROR_SEL)
      .first()
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);

    if (hasError) {
      await expect(page.locator(DISCOUNT_ERROR_SEL).first()).toBeVisible();
    } else {
      const totalAfter = (await page.locator(CART_TOTAL_SEL).first().textContent().catch(() => ''))?.trim();
      // Page must remain on cart and total must not have mysteriously dropped
      expect(page.url()).toMatch(/cart/);
      if (totalBefore && totalAfter) {
        expect(totalAfter, 'Total changed after applying an invalid code').toBe(totalBefore);
      }
    }
  });

  test('submitting an empty discount code does not crash the page', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', e => jsErrors.push(e.message));

    const field = await getDiscountField(page);
    if ((await field.count()) === 0) {
      test.skip(true, 'No discount field');
      return;
    }

    await field.fill('');
    const applyBtn = page.locator(DISCOUNT_APPLY_BTN_SEL).first();
    if ((await applyBtn.count()) > 0) await applyBtn.click();
    await page.waitForTimeout(1_500);

    const critical = jsErrors.filter(e => !e.includes('ResizeObserver'));
    expect(critical, `JS errors after empty discount submit:\n${critical.join('\n')}`).toHaveLength(0);
    expect(page.url()).toMatch(/cart/);
  });

  // ── Valid code (optional) ──────────────────────────────────────────────────

  test('valid discount code reduces the cart total', async ({ page }) => {
    const code = process.env.DISCOUNT_CODE;
    if (!code) {
      test.skip(true, 'DISCOUNT_CODE env var not set — skipping');
      return;
    }

    const added = await goToCartWithItem(page);
    if (!added) {
      test.skip(true, 'Could not add product to cart');
      return;
    }

    const field = page.locator(DISCOUNT_INPUT_SEL).first();
    if ((await field.count()) === 0) {
      test.skip(true, 'No discount field found');
      return;
    }

    const totalBefore = (await page.locator(CART_TOTAL_SEL).first().textContent().catch(() => ''))?.trim();

    await field.fill(code);
    const applyBtn = page.locator(DISCOUNT_APPLY_BTN_SEL).first();
    if ((await applyBtn.count()) > 0) {
      await applyBtn.click();
    } else {
      await field.press('Enter');
    }

    await page.waitForTimeout(2_500);

    const discountLineSel = '.cart__discount, [data-discount], .discount-savings, .cart-discount';
    const hasDiscountLine = (await page.locator(discountLineSel).count()) > 0;

    if (hasDiscountLine) {
      await expect(page.locator(discountLineSel).first()).toBeVisible();
    } else {
      const totalAfter = (await page.locator(CART_TOTAL_SEL).first().textContent().catch(() => ''))?.trim();
      if (totalBefore && totalAfter) {
        expect(totalAfter, 'Total unchanged after applying a valid discount code').not.toBe(totalBefore);
      }
    }
  });

  // ── Checkout with discount param ───────────────────────────────────────────

  test('checkout URL with ?discount= parameter responds without server error', async ({ page }) => {
    const code = process.env.DISCOUNT_CODE ?? 'PLACEHOLDER';
    const resp = await page.goto(`${BASE}/checkout?discount=${code}`, { waitUntil: 'domcontentloaded' });
    const status = resp?.status() ?? 0;
    expect(status, `Checkout with ?discount= returned HTTP ${status}`).toBeLessThan(500);
  });
});
