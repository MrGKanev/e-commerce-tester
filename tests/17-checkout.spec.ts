import { addProductToCart } from './helpers';
import { test, expect, type Page } from './fixtures';
import type { TestInfo } from '@playwright/test';
import { readSiteSettings } from '../config/site-settings';
import { CommerceUnverified } from '../scripts/storefront-model';
import {
  assertCheckoutField,
  CheckNotApplicable,
  reachCheckoutFromCart,
} from './storefront-assertions';

const settings = readSiteSettings();
const CHECKOUT_BTN_SEL =
  settings.selectors.checkoutButton ||
  [
    'button[name="checkout"]',
    'input[name="checkout"]',
    'a[href*="/checkout"]',
    '.cart__checkout-button',
    '#checkout',
    'button:has-text("Checkout")',
    'button:has-text("Check out")',
    'button:has-text("Продължи към плащане")',
    'button:has-text("Плащане")',
    'button:has-text("Поръчай")',
  ].join(', ');
async function checkout(page: Page, beforeNavigation?: () => void) {
  const added = await addProductToCart(page);
  if (!added) throw new CommerceUnverified('No available configured checkout product');
  beforeNavigation?.();
  await reachCheckoutFromCart(page, settings);
}

async function classified(info: TestInfo, action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    if (error instanceof CheckNotApplicable) {
      info.annotations.push({ type: 'not-applicable', description: error.message });
      test.skip(true, error.message);
    }
    if (!(error instanceof CommerceUnverified)) throw error;
    info.annotations.push({ type: 'checkout-unverified', description: error.message });
    test.skip(true, error.message);
  }
}
test.describe('17 · Checkout flow', { tag: '@full' }, () => {
  test('cart page shows a checkout button', async ({ page }) => {
    await addProductToCart(page);
    await expect(
      page.locator(CHECKOUT_BTN_SEL).filter({ visible: true }),
      'Expected checkout button missing or ambiguous',
    ).toHaveCount(1);
  });
  test('checkout button reaches a checkout route with readable content and no HTTP error', async ({
    page,
  }, info) => {
    await classified(info, () => checkout(page));
  });
  test('checkout URL is HTTPS', async ({ page }, info) => {
    await classified(info, async () => {
      await checkout(page);
      expect(new URL(page.url()).protocol, 'Checkout is not served over HTTPS').toBe('https:');
    });
  });
  test('checkout navigation has no critical JS errors', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await classified(info, async () => {
      await checkout(page, () => {
        errors.length = 0;
      });
      expect(
        errors.filter(
          error => !/cross-origin|ResizeObserver|Non-Error promise rejection/.test(error),
        ),
        'Checkout JavaScript errors',
      ).toEqual([]);
    });
  });
  test('expected checkout contact field is visible and editable', async ({ page }, info) => {
    await classified(info, async () => {
      await checkout(page);
      await assertCheckoutField(page, info, 'contact');
    });
  });
  test('expected checkout shipping address fields are visible and editable', async ({
    page,
  }, info) => {
    await classified(info, async () => {
      await checkout(page);
      await assertCheckoutField(page, info, 'shippingAddress');
    });
  });
  test('express checkout buttons are visible on cart when exposed', async ({ page }, info) => {
    await addProductToCart(page);
    const buttons = page
      .locator(
        '.shopify-payment-button__button, [data-shopify="payment-button"], .apple-pay-button, .gpay-button, button[aria-label*="Apple Pay"], button[aria-label*="Google Pay"], button[aria-label*="Shop Pay"]',
      )
      .filter({ visible: true });
    if (!(await buttons.count())) {
      info.annotations.push({
        type: 'checkout-unverified',
        description: 'Express checkout presence has not been configured or verified',
      });
      test.skip(true, 'No exposed express checkout buttons; not verified');
    }
    await expect(buttons.first()).toBeVisible();
  });
});
