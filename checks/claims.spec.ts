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
const settings = readSiteSettings();
const base = new URL(process.env.STORE_URL!).origin;
const checkoutPath = settings.platform === 'shopify' ? '/en/checkout' : '/wp/pay';
const cartPath = settings.platform === 'shopify' ? '/en/cart' : '/wp/cart';
async function readState(page: import('@playwright/test').Page) {
  const response = await page.context().request.get(base + '/__claims/state');
  expect(response.ok()).toBe(true);
  return (await response.json()) as { apiReads: number; submissions: number };
}
async function setMode(page: import('@playwright/test').Page, mode: string) {
  const response = await page.context().request.get(base + '/__claims/mode', { params: { mode } });
  expect(response.ok()).toBe(true);
}
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
    await setMode(page, name);
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
    expect((await readState(page)).submissions).toBe(0);
  });
}
test('supported checkout missing its expected root fails; blocked/unsupported remain unverified', async ({
  page,
}, info) => {
  await setMode(page, 'unknown');
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
  await setMode(page, 'custom');
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
  await setMode(page, 'country-no-postcode');
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
    await setMode(page, name);
    const before = (await readState(page)).apiReads;
    await page.goto(base + cartPath);
    if (name === 'good') await assertEmptyCart(page, info);
    else
      await failing(
        () => assertEmptyCart(page, info),
        name === 'api-blocked' ? CommerceUnverified : undefined,
      );
    expect((await readState(page)).apiReads).toBeGreaterThan(before);
    const evidence = JSON.stringify(
      info.attachments
        .filter(item => item.name === 'empty-cart.json')
        .map(item => item.body?.toString()),
    );
    expect(evidence).not.toContain('private-fixture-token');
  });
}
test('empty cart scenario clears and verifies the locale/session cart', async ({ page }, info) => {
  await setMode(page, 'good');
  await verifyEmptyCart(page, info);
});
for (const name of ['good', 'query-only', 'http-error', 'blocked']) {
  test(`checkout reach ${name}`, async ({ page }) => {
    await setMode(page, name);
    await page.goto(base + cartPath);
    if (name === 'good') await reachCheckoutFromCart(page);
    else
      await failing(
        () => reachCheckoutFromCart(page),
        name === 'blocked' ? CommerceUnverified : undefined,
      );
  });
}
