import { createServer, type Server } from 'node:http';
import { test, expect } from '../tests/fixtures';
import {
  assertCheckoutField,
  assertEmptyCart,
  CheckNotApplicable,
  reachCheckoutFromCart,
  verifyEmptyCart,
} from '../tests/storefront-assertions';
import { CommerceUnverified } from '../scripts/storefront-model';
import { readSiteSettings, resolveSiteSettings } from '../config/site-settings';
let server: Server;
let mode = 'good';
const settings = readSiteSettings();
const base = 'http://127.0.0.1:45994';
const checkoutPath = settings.platform === 'shopify' ? '/en/checkout' : '/wp/pay';
const cartPath = settings.platform === 'shopify' ? '/en/cart' : '/wp/cart';
let apiReads = 0;
let submissions = 0;
const body = (content: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Claims</title></head><body><main>${content}</main><script>window.Shopify={routes:{root:'/en/'}}</script></body></html>`;
const allFields =
  '<input type="email"><input name="address1"><input name="city"><input name="postalCode"><select name="countryCode"><option>BG</option></select>';
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, base);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname.endsWith('/cart.js') || url.pathname.endsWith('/wc/store/v1/cart')) {
      apiReads++;
      if (mode === 'api-blocked') {
        res.statusCode = 403;
        res.end('{}');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cart-Token', 'private-fixture-token');
      res.end(JSON.stringify({ items: mode === 'api-nonempty' ? [{ id: 1, quantity: 1 }] : [] }));
      return;
    }
    if (
      url.pathname.endsWith('/cart/clear.js') ||
      (url.pathname.endsWith('/cart/items') && req.method === 'DELETE')
    ) {
      res.setHeader('Content-Type', 'application/json');
      res.end(req.method === 'DELETE' ? '[]' : '{"items":[]}');
      return;
    }
    if (req.method !== 'GET') submissions++;
    if (url.pathname === cartPath || url.pathname === '/cart') {
      const indication =
        mode === 'form-only' || mode === 'header-empty'
          ? '<form class="cart-form"></form>'
          : mode === 'hidden-empty'
            ? '<p class="cart-empty" hidden>Your cart is empty</p>'
            : '<p class="cart-empty">Your cart is empty</p>';
      const stale =
        mode === 'stale-row' ? '<div class="cart-item" data-woo-cart-item>Product 1</div>' : '';
      const href = mode === 'query-only' ? cartPath + '?redirect=checkout' : checkoutPath;
      res.end(
        body(
          `<h1>Cart</h1>${indication}${stale}<a class="checkout-button" href="${href}">Checkout</a>`,
        ).replace(
          '<main>',
          mode === 'header-empty'
            ? '<header><p class="cart-empty">Your cart is empty</p></header><main>'
            : '<main>',
        ),
      );
      return;
    }
    if (url.pathname === checkoutPath) {
      if (mode === 'http-error' || mode === 'blocked') {
        res.statusCode = mode === 'blocked' ? 403 : 500;
        res.end(body('Access denied'));
        return;
      }
      let fields = mode === 'missing' ? '' : allFields;
      if (mode === 'hidden-email') fields = fields.replace('type="email"', 'type="email" hidden');
      if (mode === 'disabled-email')
        fields = fields.replace('type="email"', 'type="email" disabled');
      if (mode === 'missing-city') fields = fields.replace('<input name="city">', '');
      if (mode === 'country-no-postcode') fields = fields.replace('<input name="postalCode">', '');
      if (mode === 'custom') fields = '<input id="custom-contact"><input id="custom-street">';
      const root =
        mode === 'unknown'
          ? '<div>Login required</div><footer><input type="email"></footer>'
          : `<form data-checkout-root>${fields}</form>`;
      res.end(body(`<h1>Checkout</h1>${root}`));
      return;
    }
    res.statusCode = 404;
    res.end(body('Missing'));
  });
  await new Promise<void>(resolve => server.listen(45994, '127.0.0.1', resolve));
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});
async function failing(
  action: () => Promise<void>,
  constructor?: typeof CommerceUnverified | typeof CheckNotApplicable,
) {
  let failure: unknown;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  expect(failure, 'Missing evidence must never produce a passing assertion').toBeTruthy();
  if (constructor) expect(failure).toBeInstanceOf(constructor);
}
for (const name of [
  'good',
  'missing',
  'hidden-email',
  'disabled-email',
  'unknown',
  'missing-city',
]) {
  test(`checkout interface ${name}`, async ({ page }, info) => {
    mode = name;
    await page.goto(base + checkoutPath);
    if (name === 'good') {
      await assertCheckoutField(page, info, 'contact');
      await assertCheckoutField(page, info, 'shippingAddress');
    } else if (name === 'missing-city')
      await failing(() => assertCheckoutField(page, info, 'shippingAddress'));
    else
      await failing(
        () => assertCheckoutField(page, info, 'contact'),
        name === 'unknown' ? CommerceUnverified : undefined,
      );
    expect(submissions).toBe(0);
  });
}
test('supported checkout missing its expected root fails; blocked/unsupported remain unverified', async ({
  page,
}, info) => {
  mode = 'unknown';
  await page.goto(base + checkoutPath);
  await failing(() =>
    assertCheckoutField(
      page,
      info,
      'contact',
      resolveSiteSettings({ platform: settings.platform, checkout: { mode: 'supported' } }),
    ),
  );
  for (const mode of ['blocked', 'unsupported'] as const)
    await failing(
      () =>
        assertCheckoutField(
          page,
          info,
          'contact',
          resolveSiteSettings({
            checkout: { mode, reason: 'Custom provider requires another adapter' },
          }),
        ),
      CommerceUnverified,
    );
});
test('digital/staged/custom checkout policies are explicit rather than successful missing fields', async ({
  page,
}, info) => {
  mode = 'custom';
  await page.goto(base + checkoutPath);
  await failing(
    () =>
      assertCheckoutField(
        page,
        info,
        'shippingAddress',
        resolveSiteSettings({ checkout: { shippingAddress: 'not-applicable' } }),
      ),
    CheckNotApplicable,
  );
  await failing(
    () =>
      assertCheckoutField(
        page,
        info,
        'shippingAddress',
        resolveSiteSettings({ checkout: { shippingAddress: 'unverified' } }),
      ),
    CommerceUnverified,
  );
  const custom = resolveSiteSettings({
    checkout: { requiredAddressFields: ['addressLine1'] },
    selectors: { checkoutEmail: '#custom-contact', checkoutAddressLine1: '#custom-street' },
  });
  await assertCheckoutField(page, info, 'contact', custom);
  await assertCheckoutField(page, info, 'shippingAddress', custom);
  mode = 'country-no-postcode';
  await page.goto(base + checkoutPath);
  await assertCheckoutField(
    page,
    info,
    'shippingAddress',
    resolveSiteSettings({
      checkout: { requiredAddressFields: ['addressLine1', 'city', 'country'] },
    }),
  );
});
for (const name of [
  'good',
  'form-only',
  'header-empty',
  'hidden-empty',
  'stale-row',
  'api-nonempty',
  'api-blocked',
]) {
  test(`empty cart ${name}`, async ({ page }, info) => {
    mode = name;
    const before = apiReads;
    await page.goto(base + cartPath);
    if (name === 'good') await assertEmptyCart(page, info);
    else
      await failing(
        () => assertEmptyCart(page, info),
        name === 'api-blocked' ? CommerceUnverified : undefined,
      );
    expect(apiReads).toBeGreaterThan(before);
    const evidence = JSON.stringify(
      info.attachments
        .filter(item => item.name === 'empty-cart.json')
        .map(item => item.body?.toString()),
    );
    expect(evidence).not.toContain('private-fixture-token');
  });
}
test('empty cart scenario clears and verifies the locale/session cart', async ({ page }, info) => {
  mode = 'good';
  await verifyEmptyCart(page, info);
});
for (const name of ['good', 'query-only', 'http-error', 'blocked']) {
  test(`checkout reach ${name}`, async ({ page }) => {
    mode = name;
    await page.goto(base + cartPath);
    if (name === 'good') await reachCheckoutFromCart(page);
    else
      await failing(
        () => reachCheckoutFromCart(page),
        name === 'blocked' ? CommerceUnverified : undefined,
      );
  });
}
