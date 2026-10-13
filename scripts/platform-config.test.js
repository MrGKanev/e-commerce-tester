'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSites } = require('./site-config');
const { resolveSiteSettings } = require('../config/site-settings');
const {
  compatibleSpec,
  storeApiUrl,
  productReferences,
  storefrontRoute,
} = require('./platform-config');
const { parseMoney } = require('./storefront-model');
const { prices, sellability, cartFacts } = require('./woocommerce-model');
function woo() {
  return {
    url: 'https://example.test/wp',
    slug: 'woo',
    platform: 'woocommerce',
    commerce: {
      productUrls: ['/wp/goods/item/'],
      routes: { cart: '/wp/basket/', checkout: '/wp/pay/' },
    },
  };
}
test('mixed store configuration keeps legacy Shopify defaults and independent WooCommerce URLs', () => {
  const sites = validateSites(
    [
      {
        url: 'https://shop.example.test',
        slug: 'shop',
        productHandle: 'one',
        productHandle2: 'two',
      },
      woo(),
    ],
    {},
    { requireHandles: true },
  );
  assert.equal(sites[0].settings.platform, 'shopify');
  assert.equal(sites[1].settings.platform, 'woocommerce');
  assert.equal(sites[1].url, 'https://example.test/wp');
  assert.equal(
    storeApiUrl(sites[1].settings, 'products/123'),
    'https://example.test/wp/wp-json/wc/store/v1/products/123',
  );
  assert.equal(
    storefrontRoute(sites[1].settings, sites[1].url, 'cart'),
    'https://example.test/wp/basket/',
  );
  assert.equal(
    productReferences(sites[1].settings, sites[1].url, { PRODUCT_HANDLE: 'wrong-shopify' }).length,
    1,
  );
  assert.throws(() => storeApiUrl(sites[0].settings, 'cart'), /cannot be used/);
  assert.throws(
    () =>
      validateSites([
        { url: 'https://shop.example.test/wp', productHandle: 'one', productHandle2: 'two' },
      ]),
    /origins/,
  );
});
test('public Woo configuration rejects admin APIs, foreign products, unsupported platforms and missing scheduled references', () => {
  for (const value of [
    { ...woo(), platform: 'magento' },
    { ...woo(), commerce: { apiRoot: '/wp-json/wc/v3' } },
    { ...woo(), commerce: { productUrls: ['https://elsewhere.test/item'] } },
    { ...woo(), commerce: { productUrls: ['/wp-admin/'] } },
    { ...woo(), commerce: { productIds: [-1] } },
  ])
    assert.throws(() => validateSites([value], {}, { requireHandles: true }));
  assert.throws(
    () => validateSites([{ ...woo(), commerce: {} }], {}, { requireHandles: true }),
    /requires product/,
  );
  assert.equal(
    validateSites(
      [{ ...woo(), commerce: {}, inventory: { discoverProducts: true } }],
      {},
      { requireHandles: true },
    )[0].settings.platform,
    'woocommerce',
  );
  assert.throws(
    () => storeApiUrl(validateSites([woo()])[0].settings, 'checkout'),
    /Unsupported public/,
  );
});
test('platform gating excludes the other platform before execution while shared inventory checks remain common', () => {
  for (const name of [
    '01-homepage.spec.ts',
    '13-api-mock.spec.ts',
    '33-commerce-consistency.spec.ts',
  ])
    assert.equal(compatibleSpec(name, 'woocommerce'), false);
  assert.equal(compatibleSpec('34-woocommerce.spec.ts', 'shopify'), false);
  for (const name of [
    '12-performance.spec.ts',
    '29-content.spec.ts',
    '30-inventory-visual.spec.ts',
    '32-shared-pages.spec.ts',
    '35-seo-inventory.spec.ts',
    '36-buyer-journey.spec.ts',
    '39-a11y-extras.spec.ts',
    '40-a11y-dynamic.spec.ts',
  ])
    for (const platform of ['shopify', 'woocommerce'])
      assert.equal(compatibleSpec(name, platform), true);
  assert.equal(
    resolveSiteSettings({
      platform: 'shopify',
      commerce: { productUrls: ['https://unused-other-platform.test'] },
    }).commerce.productUrls.length,
    0,
  );
});
function product(currency = 'EUR', precision = 2) {
  return {
    id: 10,
    is_purchasable: true,
    is_in_stock: true,
    prices: {
      price: '1200',
      regular_price: '1500',
      currency_code: currency,
      currency_minor_unit: precision,
    },
  };
}
function cart() {
  return {
    items: [
      {
        id: 10,
        quantity: 1,
        key: 'opaque',
        totals: {
          line_subtotal: '1000',
          line_subtotal_tax: '200',
          line_total: '900',
          line_total_tax: '180',
          currency_code: 'EUR',
          currency_minor_unit: 2,
        },
      },
    ],
    coupons: [{}],
  };
}
test('WooCommerce minor units are explicit and do not inherit Shopify hundredths for zero/three-decimal currencies', () => {
  assert.equal(parseMoney('¥1,000', 'JPY', 'ja-JP', { precision: 0 }).amount, 1000);
  assert.equal(parseMoney('€12', 'EUR', 'en-US', { precision: 0 }).amount, 12);
  assert.equal(parseMoney('1.234 BHD', 'BHD', 'en-US', { precision: 3 }).amount, 1234);
  assert.equal(parseMoney('¥1,000', 'JPY', 'ja-JP').amount, 100000);
  assert.equal(prices(product('JPY', 0)).precision, 0);
});
test('WooCommerce cart taxes, discounts and precision remain distinct; unknown display tax is not guessed', () => {
  assert.equal(cartFacts(cart(), product(), 'including').displaySubtotal, 1200);
  assert.equal(cartFacts(cart(), product(), 'excluding').displaySubtotal, 1000);
  assert.equal(cartFacts(cart(), product(), 'auto').displaySubtotal, null);
  assert.equal(cartFacts(cart(), product(), 'including').discountExcludingTax, 100);
  const wrong = cart();
  wrong.items[0].id = 11;
  assert.throws(() => cartFacts(wrong, product()), /exactly/);
  const wrongQty = cart();
  wrongQty.items[0].quantity = 2;
  assert.throws(() => cartFacts(wrongQty, product()), /quantity/);
});
test('permitted backorders are purchasable while unavailable stock without permission is blocked', () => {
  assert.equal(sellability({ ...product(), is_in_stock: false }).available, false);
  assert.equal(
    sellability({ ...product(), is_in_stock: false, backorders_allowed: true }).available,
    true,
  );
  assert.equal(
    sellability({ ...product(), is_purchasable: false, backorders_allowed: true }).available,
    false,
  );
});

test('Woo buyer journey validates two-unit catalog and cart arithmetic without weakening exact quantity checks', () => {
  const { cartFacts } = require('./woocommerce-model');
  const product = { id: 11, prices: { price: '2990', regular_price: '2990', currency_code: 'EUR', currency_minor_unit: 2 } };
  const cart = { items: [{ id: 11, quantity: 2, totals: { line_subtotal: '5980', line_subtotal_tax: '0', line_total: '5980', line_total_tax: '0', currency_code: 'EUR', currency_minor_unit: 2 } }] };
  assert.equal(cartFacts(cart, product, 'excluding', 2).displaySubtotal, 5980);
  assert.throws(() => cartFacts(cart, product, 'excluding'), /quantity/);
  assert.throws(() => cartFacts({ items: [{ ...cart.items[0], totals: { ...cart.items[0].totals, line_subtotal: '2990' } }] }, product, 'excluding', 2), /differs/);
});
