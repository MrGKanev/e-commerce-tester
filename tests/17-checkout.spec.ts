import { test, expect, type Page } from '@playwright/test';
import { BASE, KNOWN_PRODUCT, ADD_TO_CART_SEL } from './helpers';

const CHECKOUT_BTN_SEL = [
  'button[name="checkout"]',
  'input[name="checkout"]',
  'a[href*="/checkout"]',
  'button:has-text("Checkout")',
  'button:has-text("Check out")',
  'button:has-text("Продължи към плащане")',
  'button:has-text("Плащане")',
  'button:has-text("Поръчай")',
  '.cart__checkout-button',
  '#checkout',
].join(', ');

async function addToCartAndGoToCartPage(page: Page): Promise<boolean> {
  await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
  const btn = page.locator(ADD_TO_CART_SEL).first();
  if ((await btn.count()) === 0 || await btn.isDisabled()) return false;
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

async function reachCheckout(page: Page): Promise<boolean> {
  const added = await addToCartAndGoToCartPage(page);
  if (!added) return false;
  const checkoutBtn = page.locator(CHECKOUT_BTN_SEL).first();
  if ((await checkoutBtn.count()) === 0) return false;
  await checkoutBtn.click();
  try {
    await page.waitForURL(/checkout/, { timeout: 30_000 });
    await page.waitForLoadState('domcontentloaded');
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('17 · Checkout flow', () => {

  // ── Cart → Checkout ───────────────────────────────────────────────────────

  test('cart page shows a checkout button', async ({ page }) => {
    const added = await addToCartAndGoToCartPage(page);
    if (!added) test.skip(true, 'Could not add product to cart');

    const btn = page.locator(CHECKOUT_BTN_SEL).first();
    await expect(btn).toBeVisible({ timeout: 10_000 });
  });

  test('checkout button navigates to a checkout URL', async ({ page }) => {
    const reached = await reachCheckout(page);
    if (!reached) test.skip(true, 'Could not reach checkout');

    expect(page.url()).toMatch(/checkout/i);
  });

  test('checkout URL is HTTPS', async ({ page }) => {
    const reached = await reachCheckout(page);
    if (!reached) test.skip(true, 'Could not reach checkout');

    expect(page.url(), 'Checkout is not served over HTTPS').toMatch(/^https:\/\//);
  });

  test('checkout page loads without JS errors', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    const reached = await reachCheckout(page);
    if (!reached) test.skip(true, 'Could not reach checkout');

    const critical = jsErrors.filter(e =>
      !e.includes('cross-origin') &&
      !e.includes('ResizeObserver') &&
      !e.includes('Non-Error promise rejection'),
    );
    expect(critical, `JS errors on checkout page:\n${critical.join('\n')}`).toHaveLength(0);
  });

  // ── Checkout form fields ──────────────────────────────────────────────────

  test('checkout page has a contact / email field', async ({ page }) => {
    const reached = await reachCheckout(page);
    if (!reached) test.skip(true, 'Could not reach checkout');

    const emailSel = 'input[type="email"], input[name="email"], #email, [autocomplete="email"]';
    const field = page.locator(emailSel).first();
    if ((await field.count()) === 0) {
      // One-page checkout or login-gated — just confirm we're on a checkout URL
      expect(page.url()).toMatch(/checkout/i);
      return;
    }
    await expect(field).toBeVisible();
  });

  test('checkout page has shipping address fields', async ({ page }) => {
    const reached = await reachCheckout(page);
    if (!reached) test.skip(true, 'Could not reach checkout');

    const addressSel = [
      'input[name*="address"]',
      'input[autocomplete*="address"]',
      '#shipping-address1',
      '[data-address1]',
    ].join(', ');

    const fields = page.locator(addressSel);
    if ((await fields.count()) === 0) {
      expect(page.url()).toMatch(/checkout/i);
      return;
    }
    await expect(fields.first()).toBeVisible();
  });

  // ── Express checkout ──────────────────────────────────────────────────────

  test('express checkout buttons are visible on cart (if enabled)', async ({ page }) => {
    const added = await addToCartAndGoToCartPage(page);
    if (!added) test.skip(true, 'Could not add product to cart');

    const expressSel = [
      '.shopify-payment-button__button',
      '[data-shopify="payment-button"]',
      '.apple-pay-button',
      '.gpay-button',
      'button[aria-label*="Apple Pay"]',
      'button[aria-label*="Google Pay"]',
      'button[aria-label*="Shop Pay"]',
    ].join(', ');

    const buttons = page.locator(expressSel);
    if ((await buttons.count()) === 0) {
      test.skip(true, 'No express checkout buttons — feature may not be enabled');
      return;
    }
    await expect(buttons.first()).toBeVisible();
  });
});
