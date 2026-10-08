import { addProductToCart, optionalVisible, waitForContent, BASE } from './helpers';
/**
 * 25 · Discount codes & promotions
 *
 * Validates that the cart discount code field is present, handles invalid
 * input gracefully, and (optionally) applies a valid code.
 *
 * Set DISCOUNT_CODE=YOURCODE in .env to enable the valid-code tests.
 */
import { test, expect, type Page } from './fixtures';


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

async function goToCartWithItem(page: import('@playwright/test').Page) {
  return addProductToCart(page);
}

async function getDiscountField(page: Page) {
  expect(await goToCartWithItem(page), 'Configured product is unavailable').toBe(true);
  if (!page.url().includes('/cart')) {
    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
  }
  return page.locator(DISCOUNT_INPUT_SEL).first();
}

async function submitDiscount(page: Page, field: import('@playwright/test').Locator) {
  const applyBtn = page.locator(DISCOUNT_APPLY_BTN_SEL).first();
  const [response] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === new URL(BASE).origin &&
        (response.request().isNavigationRequest() || /cart|discount|coupon/.test(url.pathname));
    }),
    (await applyBtn.count()) > 0 ? applyBtn.click() : field.press('Enter'),
  ]);
  expect(response.status(), 'Discount submission failed on the server').toBeLessThan(500);
  return response;
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('25 · Discount codes & promotions', { tag: ["@full"] }, () => {

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

    const totalBefore = (await page.locator(CART_TOTAL_SEL).first().textContent())?.trim();

    await field.fill('INVALID_CODE_XYZ_999');
    await submitDiscount(page, field);

    // Either an error message appears or the total is unchanged
    const hasError = await optionalVisible(page.locator(DISCOUNT_ERROR_SEL).first(), 5000);

    if (hasError) {
      await expect(page.locator(DISCOUNT_ERROR_SEL).first()).toBeVisible();
    } else {
      const totalAfter = (await page.locator(CART_TOTAL_SEL).first().textContent())?.trim();
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
    if (await field.evaluate((element: HTMLInputElement) => !element.validity.valid)) {
      const applyBtn = page.locator(DISCOUNT_APPLY_BTN_SEL).first();
      if (await applyBtn.isVisible()) await applyBtn.click();
      else await field.press('Enter');
      await expect.poll(() => field.evaluate((element: HTMLInputElement) => !element.validity.valid)).toBe(true);
    } else {
      await submitDiscount(page, field);
    }
    await waitForContent(page);
    await expect(field).toBeVisible();

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

    expect(await goToCartWithItem(page), 'Configured product is unavailable').toBe(true);

    const field = page.locator(DISCOUNT_INPUT_SEL).first();
    if ((await field.count()) === 0) {
      test.skip(true, 'No discount field found');
      return;
    }

    const totalBefore = (await page.locator(CART_TOTAL_SEL).first().textContent())?.trim();

    await field.fill(code);
    await submitDiscount(page, field);

    await expect.poll(async () => {
      const line = page.locator('.cart__discount, [data-discount], .discount-savings, .cart-discount').first();
      return await line.isVisible() || (await page.locator(CART_TOTAL_SEL).first().textContent())?.trim() !== totalBefore;
    }, { message: 'Valid discount produced neither a discount line nor a changed total' }).toBe(true);

    const discountLineSel = '.cart__discount, [data-discount], .discount-savings, .cart-discount';
    const hasDiscountLine = (await page.locator(discountLineSel).count()) > 0;

    if (hasDiscountLine) {
      await expect(page.locator(discountLineSel).first()).toBeVisible();
    } else {
      const totalAfter = (await page.locator(CART_TOTAL_SEL).first().textContent())?.trim();
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
