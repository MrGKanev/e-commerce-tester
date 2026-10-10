import { expect, type Page, type TestInfo } from '@playwright/test';
import { readSiteSettings, type SiteSettings } from '../config/site-settings';
import { CommerceUnverified } from '../scripts/storefront-model';
import { CART_ITEMS_SEL, waitForContent } from './helpers';
import { shopifyCommerce } from './commerce-consistency';

export class CheckNotApplicable extends Error {}
export async function assertCheckoutField(
  page: Page,
  info: TestInfo,
  kind: 'contact' | 'shippingAddress',
  settings: SiteSettings = readSiteSettings(),
) {
  const policy = settings.checkout;
  const evidence: Record<string, unknown> = {
    kind,
    expected: policy[kind],
    mode: policy.mode,
    fields: [],
  };
  try {
    if (policy[kind] === 'not-applicable')
      throw new CheckNotApplicable(`${kind} explicitly not applicable for this store`);
    if (policy[kind] === 'unverified' || ['unsupported', 'blocked'].includes(policy.mode))
      throw new CommerceUnverified(
        policy.reason ||
          `${kind} is explicitly ${policy.mode === 'auto' || policy.mode === 'supported' ? 'unverified' : policy.mode}`,
      );
    const roots = page
      .locator(
        settings.selectors.checkoutRoot ||
          'form.checkout, .wc-block-checkout, [data-woo-checkout], [data-checkout-root], form[action*="/checkouts"], form[data-checkout], #Form1',
      )
      .filter({ visible: true });
    if (policy.mode === 'auto') {
      try {
        await expect(roots).toHaveCount(1);
      } catch {
        throw new CommerceUnverified(
          'Checkout interface is not uniquely recognized; configure checkoutRoot and expected fields',
        );
      }
    }
    await expect(roots, 'Expected checkout interface is missing or ambiguous').toHaveCount(1);
    const selectors = {
      contact:
        settings.selectors.checkoutEmail ||
        'input[type="email"], input[name="email"], input[autocomplete="email"]',
      addressLine1:
        settings.selectors.checkoutAddressLine1 ||
        'input[autocomplete="shipping address-line1"], input[autocomplete="address-line1"], input[name="shipping_address_1"], input[name="address1"], input[name="shippingAddress.address1"], #shipping-address1',
      city:
        settings.selectors.checkoutCity ||
        'input[autocomplete="shipping address-level2"], input[autocomplete="address-level2"], input[name="shipping_city"], input[name="city"], input[name="shippingAddress.city"]',
      postalCode:
        settings.selectors.checkoutPostalCode ||
        'input[autocomplete="shipping postal-code"], input[autocomplete="postal-code"], input[name="shipping_postcode"], input[name="postalCode"], input[name="shippingAddress.zip"]',
      country:
        settings.selectors.checkoutCountry ||
        'select[autocomplete="shipping country"], select[autocomplete="shipping country-name"], select[autocomplete="country"], select[name="shipping_country"], select[name="countryCode"], select[name="shippingAddress.countryCode"], input[autocomplete="shipping country"]',
    };
    const fields = kind === 'contact' ? (['contact'] as const) : policy.requiredAddressFields;
    const observations: Record<string, unknown>[] = [];
    evidence.fields = observations;
    for (const name of fields) {
      const field = roots.locator(selectors[name]).filter({ visible: true });
      const observation = { name, count: await field.count(), editable: false };
      observations.push(observation);
      await expect(field, `Required checkout ${name} field is missing or ambiguous`).toHaveCount(1);
      await expect(field, `Required checkout ${name} field is not editable`).toBeEditable();
      observation.count = await field.count();
      observation.editable = true;
    }
    evidence.status = 'passed';
  } catch (error) {
    evidence.status =
      error instanceof CheckNotApplicable
        ? 'not-applicable'
        : error instanceof CommerceUnverified
          ? 'unverified'
          : 'failed';
    evidence.reason = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await info.attach('checkout-interface.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  }
}

/** An empty-looking form never substitutes for a genuinely empty visitor cart. */
export async function assertEmptyCart(
  page: Page,
  info: TestInfo,
  settings: SiteSettings = readSiteSettings(),
) {
  const evidence: Record<string, unknown> = {
    expected: { items: [], visibleRows: 0, emptyIndicator: true },
  };
  try {
    await waitForContent(page);
    let items: Array<{ quantity: number }>;
    if (settings.platform === 'woocommerce') {
      const { wooSession } = await import('./platforms/woocommerce');
      items = (await wooSession(page).cart()).items;
    } else {
      const root = await shopifyCommerce.routeRoot(page);
      const response = await page.context().request.get(root + 'cart.js');
      if ([401, 403, 429].includes(response.status()))
        throw new CommerceUnverified(`Public cart verification blocked: HTTP ${response.status()}`);
      expect(response.ok(), 'Public cart API failed').toBe(true);
      const data = await response.json();
      expect(Array.isArray(data.items), 'Cart API has no valid items list').toBe(true);
      items = data.items;
    }
    const rows = page
      .locator(settings.selectors.cartItems || CART_ITEMS_SEL)
      .filter({ visible: true });
    const content = page
      .locator(settings.selectors.main || 'main, [role="main"], #main-content')
      .filter({ visible: true });
    if ((await content.count()) !== 1)
      throw new CommerceUnverified('Cannot uniquely scope the cart page; configure selectors.main');
    const indicators = content
      .locator(
        settings.selectors.cartEmpty ||
          '.cart__empty-text, .cart-empty, [data-cart-empty], .wc-block-cart__empty-cart__title, [class*="empty"]:text-matches("empty|празн|leer|vide", "i"), p:text-matches("cart.*empty|количк.*празн|празн.*количк", "i")',
      )
      .filter({ visible: true });
    evidence.actual = {
      quantities: items.map(item => item.quantity),
      visibleRows: await rows.count(),
      emptyIndicators: await indicators.count(),
    };
    expect(items.length, 'Public visitor cart must be genuinely empty').toBe(0);
    await expect(rows, 'Cart UI still contains product rows').toHaveCount(0);
    expect(
      await indicators.count(),
      'Cart UI has no explicit visible empty-state indication; configure cartEmpty for custom themes',
    ).toBeGreaterThan(0);
    expect(
      (await indicators.first().innerText()).trim(),
      'Empty-state indicator is blank',
    ).not.toBe('');
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = error instanceof CommerceUnverified ? 'unverified' : 'failed';
    evidence.reason = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await info.attach('empty-cart.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  }
}

export async function verifyEmptyCart(page: Page, info: TestInfo) {
  const { CART_URL } = await import('./helpers');
  const settings = readSiteSettings();
  const response = await page.goto(CART_URL, { waitUntil: 'domcontentloaded' });
  if (response && [401, 403, 429].includes(response.status()))
    throw new CommerceUnverified('Cart page access is blocked');
  expect(response?.status(), 'Cart page failed to load').toBeLessThan(400);
  if (settings.platform === 'woocommerce') {
    const { wooSession } = await import('./platforms/woocommerce');
    await wooSession(page).clearCart();
    await page.reload({ waitUntil: 'domcontentloaded' });
  } else {
    const root = await shopifyCommerce.routeRoot(page);
    await shopifyCommerce.clearSession(page, root);
    await page.goto(root + 'cart', { waitUntil: 'domcontentloaded' });
  }
  await assertEmptyCart(page, info, settings);
}

export async function reachCheckoutFromCart(
  page: Page,
  settings: SiteSettings = readSiteSettings(),
) {
  const control = page
    .locator(
      settings.selectors.checkoutButton ||
        'button[name="checkout"], input[name="checkout"], a[href*="/checkout"], .cart__checkout-button, #checkout, .checkout-button, .wc-block-cart__submit-button, button:has-text("Checkout"), button:has-text("Check out"), button:has-text("Продължи към плащане"), button:has-text("Плащане"), button:has-text("Поръчай")',
    )
    .filter({ visible: true });
  await expect(control, 'Checkout control is missing or ambiguous').toHaveCount(1);
  const statuses: number[] = [];
  const response = (event: import('@playwright/test').Response) => {
    if (event.request().isNavigationRequest() && event.request().frame() === page.mainFrame())
      statuses.push(event.status());
  };
  page.on('response', response);
  try {
    await control.click();
    await expect
      .poll(
        () => {
          const pathname = new URL(page.url()).pathname;
          return settings.platform === 'shopify'
            ? /\/checkouts?(?:\/|$)/i.test(pathname)
            : pathname.replace(/\/$/, '') ===
                new URL(settings.commerce.routes.checkout).pathname.replace(/\/$/, '');
        },
        { message: 'Checkout control did not reach the expected checkout route' },
      )
      .toBe(true);
    await page.waitForLoadState('domcontentloaded');
    if (statuses.some(status => [401, 403, 429].includes(status)))
      throw new CommerceUnverified(
        'Checkout navigation is blocked by HTTP access/rate-limit response',
      );
    expect(
      statuses.filter(status => status >= 400),
      'Checkout navigation returned an HTTP error',
    ).toEqual([]);
    await waitForContent(page);
  } finally {
    page.off('response', response);
  }
}
